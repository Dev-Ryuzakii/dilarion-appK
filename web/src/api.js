const API_BASE = (import.meta.env.VITE_API_BASE || 'https://testdilarion.eibstratoc.com').replace(/\/$/, '')

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
export const forgotOrganizationPassword = (payload) => request('/organization/auth/forgot-password', { method: 'POST', body: JSON.stringify(payload) })
export const resetOrganizationPassword = (payload) => request('/organization/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) })
export const getOrganization = (token) => request('/organization/me', { headers: { Authorization: `Bearer ${token}` } })
export const getOrganizationUsers = (token) => request('/organization/users', { headers: { Authorization: `Bearer ${token}` } })
// Organizations can invite their own staff (no edit/suspend - that stays with Dilarion admins).
export const inviteOrganizationStaff = (token, users) => request('/organization/users', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ users }) })
export const resetStaffLogin = (token, userId) => request(`/organization/users/${userId}/reset-login`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
export const resendStaffInvite = (token, userId) => request(`/organization/users/${userId}/resend-invite`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

// Org-wide admin: delegate company-wide privileges to chosen staff, and send
// official broadcasts. The organization account holds every privilege.
export const getOrgStaffPrivileges = (token) => request('/organization/staff', { headers: { Authorization: `Bearer ${token}` } })
export const setStaffPrivileges = (token, username, privileges) => request(`/organization/staff/${encodeURIComponent(username)}/privileges`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ privileges }) })
export const sendOrgBroadcast = (token, payload) => request('/organization/broadcast', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
export const getOrgBroadcasts = (token) => request('/organization/broadcasts', { headers: { Authorization: `Bearer ${token}` } })
