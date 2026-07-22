export function canAccessDashboard(email: string): boolean {
  return email.trim().length > 0;
}

export function canRunAdminJob(userEmail: string, adminEmail: string): boolean {
  const normalizedUser = userEmail.trim().toLowerCase();
  const normalizedAdmin = adminEmail.trim().toLowerCase();
  return normalizedAdmin.length > 0 && normalizedUser === normalizedAdmin;
}
