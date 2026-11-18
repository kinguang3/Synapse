'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

class GuiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'GuiError';
    this.status = options && options.status ? options.status : 0;
    this.code = options && options.code ? options.code : 'GUI_ERROR';
    this.details = options && options.details ? options.details : {};
  }
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (error) {
    throw new GuiError('Synapse server URL is invalid', { code: 'INVALID_SERVER_URL' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GuiError('Synapse server URL must use http or https', { code: 'INVALID_SERVER_URL' });
  }
  if (url.username || url.password) {
    throw new GuiError('Synapse server URL must not contain credentials', { code: 'INVALID_SERVER_URL' });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new GuiError('Synapse server URL must use a loopback host', { code: 'NON_LOOPBACK_SERVER' });
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function buildUrl(baseUrl, path, params) {
  const base = baseUrl.toString().replace(/\/+$/, '');
  const url = new URL(base + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  return url;
}

class GuiClient {
  constructor(options) {
    const opts = options || {};
    this.baseUrl = normalizeBaseUrl(opts.baseUrl || 'http://127.0.0.1:8765');
    this.token = String(opts.token || '');
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.timeoutMs = Number(opts.timeoutMs || 15000);
    if (typeof this.fetchImpl !== 'function') {
      throw new GuiError('Fetch is unavailable in this host', { code: 'FETCH_UNAVAILABLE' });
    }
  }

  withToken(token) {
    return new GuiClient({
      baseUrl: this.baseUrl.toString(),
      token,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async fetchJson(url, options) {
    const request = options || {};
    const requestTimeout = Number(request.timeoutMs || this.timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: request.method || 'GET',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new GuiError('Synapse request timed out', { code: 'TIMEOUT' });
      }
      throw new GuiError('Synapse service is unavailable', {
        code: 'SERVICE_UNAVAILABLE',
        details: { cause: String(error && error.message ? error.message : error) },
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = null;
      }
    }
    if (!response.ok) {
      const body = payload && payload.error ? payload.error : {};
      throw new GuiError(
        String(body.message || response.statusText || 'Synapse request failed'),
        {
          status: response.status,
          code: String(body.code || (response.status === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR')),
          details: body.details || {},
        },
      );
    }
    return payload;
  }

  async health() {
    return this.fetchJson(buildUrl(this.baseUrl, '/api/v1/health'), { method: 'GET' });
  }

  async request(path, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const url = buildUrl(this.baseUrl, path, opts.params);
    return this.fetchJson(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      timeoutMs: opts.timeoutMs,
    });
  }

  async projects() {
    const data = await this.request('/api/v1/projects');
    return Array.isArray(data && data.projects) ? data.projects : [];
  }

  async projectStatus(projectId) {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/status`);
  }

  async overview(projectId) {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/overview`);
  }

  async search(projectId, query, options) {
    const opts = options || {};
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/search`, {
      params: {
        q: query,
        mode: opts.mode || 'hybrid',
        node_types: opts.nodeTypes,
        path_prefix: opts.pathPrefix,
        limit: opts.limit || 20,
      },
    });
  }

  async graphOverview(projectId, options) {
    const opts = options || {};
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/graph/overview`, {
      params: {
        max_nodes: opts.maxNodes || 80,
        node_types: opts.nodeTypes,
        relation_types: opts.relationTypes,
      },
    });
  }

  async graphCapabilities(projectId) {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/graph/capabilities`,
    );
  }

  async graphStructure(projectId, options) {
    const opts = options || {};
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/graph/structure`, {
      params: {
        path_prefix: opts.pathPrefix,
        limit: opts.limit || 200,
      },
    });
  }

  async node(projectId, nodeId) {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
    );
  }

  async graphNeighbors(projectId, nodeId, options) {
    const opts = options || {};
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/graph/${encodeURIComponent(nodeId)}/neighbors`,
      {
        params: {
          depth: opts.depth == null ? 1 : opts.depth,
          direction: opts.direction || 'both',
          relation_types: opts.relationTypes,
          node_types: opts.nodeTypes,
          limit: opts.limit || 50,
        },
      },
    );
  }

  async memories(projectId, options) {
    const opts = options || {};
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/memories`, {
      params: {
        memory_type: opts.memoryType,
        q: opts.query,
        limit: opts.limit || 20,
        offset: opts.offset || 0,
      },
    });
  }

  async memory(projectId, nodeId) {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(nodeId)}`,
    );
  }

  async context(projectId, options) {
    const opts = options || {};
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/context`, {
      params: {
        q: opts.query,
        max_tokens: opts.maxTokens || 2000,
      },
    });
  }

  async index(projectId, full) {
    return this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/index`, {
      method: 'POST',
      params: full ? { full: 'true' } : undefined,
      timeoutMs: 180000,
    });
  }
}

module.exports = {
  GuiClient,
  GuiError,
  buildUrl,
  normalizeBaseUrl,
};
