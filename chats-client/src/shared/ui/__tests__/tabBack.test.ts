import { tabAfterBack } from '../tabBack';

describe('Back between the tabs', () => {
  it('New Chat and Settings go back to Chats', () => {
    expect(tabAfterBack('settings', 'chats', false)).toBe('chats');
    expect(tabAfterBack('new-chat', 'chats', false)).toBe('chats');
  });

  it('on Chats, or with a chat open, the press is not ours', () => {
    expect(tabAfterBack('chats', 'chats', false)).toBeNull();
    expect(tabAfterBack('settings', 'chats', true)).toBeNull();
  });
});
