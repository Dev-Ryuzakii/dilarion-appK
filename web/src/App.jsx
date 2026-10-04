import { useEffect, useMemo, useState } from 'react'
import logoUrl from '../logo.jpg'
import { getOrganization, getOrganizationUsers, loginOrganization, submitOrganization } from './api'
// Installers are served from file storage (e.g. a public Afribase bucket) set
// in VITE_DOWNLOAD_BASE.
// Empty = same folder as the site, for local testing.
const DOWNLOAD_BASE = (import.meta.env.VITE_DOWNLOAD_BASE || '').replace(/\/$/, '')
const downloadUrl = (file) => (DOWNLOAD_BASE ? `${DOWNLOAD_BASE}/${file}` : file)

const Icon = ({ name, size = 20 }) => {
  const paths = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>,
    building: <><path d="M3 21h18"/><path d="M6 21V7l6-4 6 4v14"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    lock: <><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Header({ navigate, authenticated }) {
  const [open, setOpen] = useState(false)
  const go = (next) => { setOpen(false); navigate(next) }
  return <header className="site-header">
    <button className="brand" onClick={() => go(authenticated ? 'dashboard' : 'home')}><img src={logoUrl} alt=""/><span>Dilarion</span></button>
    <button className="mobile-menu" onClick={() => setOpen(!open)} aria-label="Open navigation"><Icon name={open ? 'close' : 'menu'}/></button>
    <nav className={open ? 'nav-open' : ''}>
      {!authenticated && <><button onClick={() => go('home')}>Overview</button><button onClick={() => go('request')}>Request account</button><button onClick={() => go('login')} className="nav-login">Organization login <Icon name="arrow" size={16}/></button></>}
      {authenticated && <span className="access-pill"><Icon name="eye" size={15}/> Read-only access</span>}
    </nav>
  </header>
}

function Home({ navigate }) {
  return <main>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span/> Private communication for serious teams</div>
        <h1>Your organization,<br/><em>securely connected.</em></h1>
        <p>Dilarion gives approved organizations a protected space for messaging, calling, and collaboration—without sacrificing control or privacy.</p>
        <div className="hero-actions"><button className="button primary" onClick={() => navigate('request')}>Request an organization account <Icon name="arrow"/></button><button className="button ghost" onClick={() => navigate('login')}>Sign in to your portal</button></div>
        <div className="trust-line"><span><Icon name="check" size={15}/> Admin reviewed</span><span><Icon name="check" size={15}/> Organization isolated</span><span><Icon name="check" size={15}/> Encrypted by design</span></div>
      </div>
      <div className="hero-visual"><div className="glow"/><div className="portal-card"><div className="portal-top"><div className="mini-brand"><img src={logoUrl} alt=""/> Dilarion</div><span>Protected</span></div><div className="portal-body"><div className="org-mark"><Icon name="building" size={30}/></div><div><small>ORGANIZATION PORTAL</small><h3>Northstar Group</h3><p>Approved workspace</p></div></div><div className="member-stack">{['AO','KM','TN','RJ'].map((x,i)=><span key={x} style={{'--i':i}}>{x}</span>)}<div><strong>42 staff</strong><small>Securely provisioned</small></div></div><div className="security-row"><Icon name="shield"/><div><strong>Organization boundary active</strong><small>Members only see people in their organization</small></div></div></div><div className="floating-note"><Icon name="lock"/><div><strong>End-to-end protected</strong><small>Private by default</small></div></div></div>
    </section>
    <section className="principles"><div className="section-heading"><div><span className="kicker">BUILT FOR ORGANIZATIONS</span><h2>Control without complexity.</h2></div><p>A clear approval process, secure staff onboarding, and strict separation between organizations.</p></div><div className="principle-grid"><article><span>01</span><Icon name="building" size={28}/><h3>Request access</h3><p>Submit organization details and choose credentials for your read-only portal.</p></article><article><span>02</span><Icon name="shield" size={28}/><h3>Admin approval</h3><p>A Dilarion platform admin reviews the request and creates the organization.</p></article><article><span>03</span><Icon name="users" size={28}/><h3>Staff provisioning</h3><p>Only Dilarion admins and operators add staff. Your portal simply shows the roster.</p></article></div></section>
    <section className="download-strip"><div><span className="kicker">DILARION FOR WINDOWS</span><h2>Work securely from every desk.</h2><p>Use the organization portal on the web and Dilarion for Windows for protected day-to-day communication.</p></div><div className="download-actions"><a className="button light" href={downloadUrl('dilarion-windows.msi')} download><Icon name="download"/> Download for Windows</a></div></section>
  </main>
}

const Field = ({ label, hint, ...props }) => <label className="field"><span>{label}</span><input {...props}/>{hint && <small>{hint}</small>}</label>

function RequestPage({ navigate }) {
  const [form,setForm] = useState({organization_name:'',contact_name:'',contact_email:'',contact_phone:'',username:'',password:'',confirm:''})
  const [state,setState] = useState({loading:false,error:'',success:false,id:null})
  const update = (key) => (e) => setForm({...form,[key]:e.target.value})
  const submit = async (e) => { e.preventDefault(); if(form.password!==form.confirm)return setState({...state,error:'Passwords do not match.'}); setState({loading:true,error:'',success:false,id:null}); try{const data=await submitOrganization({organization_name:form.organization_name,contact_name:form.contact_name,contact_email:form.contact_email,contact_phone:form.contact_phone,username:form.username,password:form.password});setState({loading:false,error:'',success:true,id:data.request_id})}catch(error){setState({loading:false,error:error.message,success:false,id:null})} }
  if(state.success)return <main className="form-page"><div className="success-card"><div className="success-icon"><Icon name="check" size={30}/></div><span className="kicker">REQUEST RECEIVED</span><h1>Your organization is in review.</h1><p>A platform administrator will review your request before the organization portal becomes available.</p><div className="reference">Request reference <strong>#{state.id}</strong></div><button className="button primary" onClick={()=>navigate('home')}>Return to overview</button></div></main>
  return <main className="form-page"><div className="form-intro"><span className="kicker">ORGANIZATION ACCESS</span><h1>Request your<br/>Dilarion workspace.</h1><p>Create the credentials your organization will use to open its read-only staff portal after approval.</p><div className="info-card"><Icon name="eye"/><div><strong>Your portal is view only</strong><p>Your account can see its staff list. Only Dilarion admins and operators can add or manage staff.</p></div></div></div><form className="request-form" onSubmit={submit}><div className="form-head"><span>01</span><div><h2>Organization details</h2><p>Tell us who is requesting access.</p></div></div><Field label="Organization name" value={form.organization_name} onChange={update('organization_name')} placeholder="e.g. Northstar Group" required/><div className="field-row"><Field label="Contact person" value={form.contact_name} onChange={update('contact_name')} placeholder="Full name" required/><Field label="Phone number" value={form.contact_phone} onChange={update('contact_phone')} placeholder="+234…" required/></div><Field label="Work email" type="email" value={form.contact_email} onChange={update('contact_email')} placeholder="name@organization.com" required/><div className="form-divider"/><div className="form-head"><span>02</span><div><h2>Portal credentials</h2><p>Use these to sign in after approval.</p></div></div><Field label="Organization username" value={form.username} onChange={update('username')} placeholder="northstar-portal" minLength="3" required hint="This identifies your organization account."/><div className="field-row"><Field label="Password" type="password" value={form.password} onChange={update('password')} placeholder="Minimum 8 characters" minLength="8" required/><Field label="Confirm password" type="password" value={form.confirm} onChange={update('confirm')} placeholder="Repeat password" minLength="8" required/></div>{state.error&&<div className="form-error">{state.error}</div>}<button className="button primary submit" disabled={state.loading}>{state.loading?'Submitting request…':'Submit for approval'} <Icon name="arrow"/></button><p className="form-foot">By submitting, you confirm that you are authorized to request access for this organization.</p></form></main>
}

function LoginPage({ navigate,onLogin }) {
  const [form,setForm]=useState({username:'',password:''}); const [state,setState]=useState({loading:false,error:''})
  const submit=async(e)=>{e.preventDefault();setState({loading:true,error:''});try{const data=await loginOrganization(form);onLogin(data.token);navigate('dashboard')}catch(error){setState({loading:false,error:error.message})}}
  return <main className="login-page"><div className="login-aside"><div className="login-quote"><Icon name="shield" size={34}/><blockquote>“A clear view of your people, inside a workspace built around organizational privacy.”</blockquote><p>Dilarion organization portal</p></div></div><div className="login-panel"><div className="login-box"><span className="kicker">ORGANIZATION PORTAL</span><h1>Welcome back.</h1><p>Sign in with the credentials submitted in your approved request.</p><form onSubmit={submit}><Field label="Organization username" value={form.username} onChange={(e)=>setForm({...form,username:e.target.value})} placeholder="Your organization username" required/><Field label="Password" type="password" value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} placeholder="Your password" required/>{state.error&&<div className="form-error">{state.error}</div>}<button className="button primary submit" disabled={state.loading}>{state.loading?'Signing in…':'Open organization portal'} <Icon name="arrow"/></button></form><button className="text-button" onClick={()=>navigate('request')}>Don’t have an account? Request access</button></div></div></main>
}

function Dashboard({ token,logout }) {
  const [data,setData]=useState({organization:null,users:[],loading:true,error:''}); const [query,setQuery]=useState('')
  useEffect(()=>{Promise.all([getOrganization(token),getOrganizationUsers(token)]).then(([organization,roster])=>setData({organization,users:roster.users,loading:false,error:''})).catch(error=>setData({organization:null,users:[],loading:false,error:error.message}))},[token])
  const filtered=useMemo(()=>data.users.filter(u=>`${u.full_name} ${u.username} ${u.email} ${u.department}`.toLowerCase().includes(query.toLowerCase())),[data.users,query])
  if(data.loading)return <main className="loading-screen"><div className="loader"/><p>Opening your organization portal…</p></main>
  if(data.error)return <main className="loading-screen"><p>{data.error}</p><button className="button primary" onClick={logout}>Return to login</button></main>
  return <main className="dashboard"><aside className="sidebar"><div><div className="side-org"><div className="org-avatar">{data.organization?.name?.slice(0,2).toUpperCase()}</div><div><small>ORGANIZATION</small><strong>{data.organization?.name}</strong></div></div><nav><button className="active"><Icon name="users"/> Staff directory</button></nav></div><button className="logout" onClick={logout}><Icon name="logout"/> Sign out</button></aside><section className="dash-content"><div className="dash-top"><div><span className="kicker">ORGANIZATION PORTAL</span><h1>Staff directory</h1><p>Everyone currently assigned to {data.organization?.name}.</p></div><span className="access-pill"><Icon name="eye" size={15}/> Read-only access</span></div><div className="summary-row"><div><Icon name="users"/><span><strong>{data.users.length}</strong><small>Total staff</small></span></div><div><span className="status-dot"/><span><strong>{data.users.filter(u=>u.is_active).length}</strong><small>Active accounts</small></span></div><div><Icon name="shield"/><span><strong>Isolated</strong><small>Organization boundary</small></span></div></div><div className="roster-card"><div className="roster-tools"><div><h2>People</h2><span>{filtered.length} {filtered.length===1?'person':'people'}</span></div><label className="search"><Icon name="search"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search staff"/></label></div><div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Department</th><th>Contact</th><th>Status</th></tr></thead><tbody>{filtered.map(user=><tr key={user.id}><td><div className="person"><span>{(user.full_name||user.username).split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</span><div><strong>{user.full_name||user.username}</strong><small>@{user.username}</small></div></div></td><td>{user.department||'—'}</td><td><strong className="contact-email">{user.email||'—'}</strong><small>{user.phone_number}</small></td><td><span className={`status ${user.is_active?'active':'inactive'}`}>{user.is_active?'Active':'Inactive'}</span></td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty-state"><Icon name="users" size={34}/><h3>{query?'No matching staff':'No staff added yet'}</h3><p>{query?'Try a different search term.':'A Dilarion admin or operator will add staff to this organization.'}</p></div>}</div></div><p className="readonly-note"><Icon name="lock" size={15}/> This directory is view only. Contact a Dilarion administrator to change staff access.</p></section></main>
}

export default function App(){
  const [token,setToken]=useState(()=>localStorage.getItem('dilarion_org_token')||'')
  const pageFromHash=()=>location.hash.replace('#/','')||(token?'dashboard':'home'); const [page,setPage]=useState(pageFromHash)
  useEffect(()=>{const listener=()=>setPage(pageFromHash());addEventListener('hashchange',listener);return()=>removeEventListener('hashchange',listener)},[token])
  const navigate=(next)=>{location.hash=`#/${next}`;setPage(next);window.scrollTo(0,0)}
  const onLogin=(nextToken)=>{localStorage.setItem('dilarion_org_token',nextToken);setToken(nextToken)}
  const logout=()=>{localStorage.removeItem('dilarion_org_token');setToken('');navigate('login')}
  const authenticated=Boolean(token&&page==='dashboard')
  return <><Header navigate={navigate} authenticated={authenticated}/>{page==='home'&&<Home navigate={navigate}/>} {page==='request'&&<RequestPage navigate={navigate}/>} {page==='login'&&<LoginPage navigate={navigate} onLogin={onLogin}/>} {page==='dashboard'&&(token?<Dashboard token={token} logout={logout}/>:<LoginPage navigate={navigate} onLogin={onLogin}/>)}</>
}
