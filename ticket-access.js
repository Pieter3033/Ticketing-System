(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.InternalTicketAccess = policy;
}(typeof globalThis === 'object' ? globalThis : this, function () {
  const IBLS_USER_TYPE = 12;
  const CRM_USER_TYPE = 13;
  function userType(user) {
    const raw = user?.user_type ?? user?.userType;
    return raw == null || String(raw).trim() === '' ? null : Number(raw);
  }
  function isIBLS(user) { return userType(user) === IBLS_USER_TYPE; }
  function isCRM(user) { return userType(user) === CRM_USER_TYPE; }
  function isRequester(user) { return isIBLS(user) || isCRM(user); }
  function requesterGroup(user) { return isIBLS(user) ? 'IBLS' : isCRM(user) ? 'CRM' : 'Internal'; }
  function canManage(user, ticket) {
    return Boolean(user?.userId) && Number.isInteger(userType(user)) && !isRequester(user)
      && ticket?.canManage !== false && ticket?.canManage !== 0;
  }
  return { IBLS_USER_TYPE, CRM_USER_TYPE, userType, isIBLS, isCRM, isRequester, requesterGroup, canManage };
}));
