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
// Up to 50 at once; no ids = the oldest pending invitations the server can send to now.
export const resendStaffInvites = (token, userIds) => request('/organization/users/resend-invites', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ user_ids: userIds && userIds.length ? userIds : null }) })
export const resendStaffInvite = (token, userId) => request(`/organization/users/${userId}/resend-invite`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

// Org-wide admin: delegate company-wide privileges to chosen staff, and send
// official broadcasts. The organization account holds every privilege.
export const getOrgStaffPrivileges = (token) => request('/organization/staff', { headers: { Authorization: `Bearer ${token}` } })
export const setStaffPrivileges = (token, username, privileges) => request(`/organization/staff/${encodeURIComponent(username)}/privileges`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ privileges }) })
export const sendOrgBroadcast = (token, payload) => request('/organization/broadcast', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
export const getOrgBroadcasts = (token) => request('/organization/broadcasts', { headers: { Authorization: `Bearer ${token}` } })

// Org-scoped account-deletion approvals (needs the "approve_deletions" privilege).
// Staff who lost their recovery code: approving emails them a new one.
export const getOrgResetRequests = (token) => request('/organization/password-reset-requests', { headers: { Authorization: `Bearer ${token}` } })
export const approveOrgReset = (token, id) => request(`/organization/password-reset-requests/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
export const denyOrgReset = (token, id, reason) => request(`/organization/password-reset-requests/${id}/deny`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ reason }) })
export const getOrgDeletionRequests = (token) => request('/organization/account-deletion-requests', { headers: { Authorization: `Bearer ${token}` } })
export const approveOrgDeletion = (token, id) => request(`/organization/account-deletion-requests/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
export const denyOrgDeletion = (token, id, reason) => request(`/organization/account-deletion-requests/${id}/deny`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ reason }) })

// Roles & permissions (Teams-style): org roles, who holds which role, and
// per-group settings that limit what members and guests can do.
export const getPermissionCatalog = (token) => request('/org/permissions/catalog', { headers: { Authorization: `Bearer ${token}` } })
export const getOrgRoles = (token) => request('/org/roles', { headers: { Authorization: `Bearer ${token}` } })
export const createOrgRole = (token, payload) => request('/org/roles', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
export const updateOrgRole = (token, id, payload) => request(`/org/roles/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
export const deleteOrgRole = (token, id) => fetchNoContent(`/org/roles/${id}`, token)
export const getMemberRoles = (token) => request('/org/members/roles', { headers: { Authorization: `Bearer ${token}` } })
export const assignMemberRole = (token, userId, roleId) => request(`/org/members/${userId}/role`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ role_id: roleId }) })
export const getGroupPolicies = (token) => request('/org/groups/policies', { headers: { Authorization: `Bearer ${token}` } })
export const setGroupPolicy = (token, groupId, settings) => request(`/groups/${groupId}/policy`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ settings }) })

// DELETE endpoints answer 204 with no body.
async function fetchNoContent(path, token) {
  const response = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  }
}
