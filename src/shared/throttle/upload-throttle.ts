export const uploadThrottle = {
  default: { limit: 10, ttl: 60_000 },
  shared: true,
};
