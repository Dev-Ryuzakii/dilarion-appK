const API_BASE = (import.meta.env.VITE_API_BASE || 'https://apidilarion.eibstratoc.com').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data.detail
    throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Something went wrong. Please try again.')
  }
  return data
}

export const submitOrganization = (payload) => request('/organization-requests', { method: 'POST', body: JSON.stringify(payload) })
export const loginOrganization = (payload) => request('/organization/auth/login', { method: 'POST', body: JSON.stringify(payload) })
export const getOrganization = (token) => request('/organization/me', { headers: { Authorization: `Bearer ${token}` } })
export const getOrganizationUsers = (token) => request('/organization/users', { headers: { Authorization: `Bearer ${token}` } })
