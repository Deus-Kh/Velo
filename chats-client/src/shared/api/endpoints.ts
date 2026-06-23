export const API_ENDPOINTS = {
  BASE: '',
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    CHANGE_PASSWORD: '/auth/change-password',
  },
  USER: {
  ME: '/users/me',
  PUSH_TOKEN: '/users/me/push-token',
  PUBLIC_KEY: '/users/public-key',          // POST
  PUBLIC_KEY_BY_ID: '/users/public-key/',   // GET /:userId
},

  CHAT: {
    LIST: '/chats',
  },
  CONVERSATIONS: {
    LIST: '/conversations',
  },
} as const;
