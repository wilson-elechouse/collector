export const TENANTS = [
  { id: 't-acme', name: 'Acme Trading' },
  { id: 't-beta', name: 'Beta Services' }
];

export function findTenantById(id) {
  return TENANTS.find((t) => t.id === id) || null;
}
