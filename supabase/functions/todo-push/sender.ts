// todo-push Edge Function의 web-push 발송기.
// TTL 600초: 폰이 꺼져 있다가 10분 넘게 지난 '5분 전' 알림은 띄우지 않는다.

export const PUSH_OPTIONS = { TTL: 600, urgency: 'high' };

export function toBase64Url(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hasVapidKeys(config: any): boolean {
  return Boolean(config && config.vapid_public_key && config.vapid_private_key);
}

export function createSender(webpush: any, config: any) {
  if (webpush && typeof webpush.setVapidDetails === 'function' && hasVapidKeys(config)) {
    webpush.setVapidDetails(
      config.vapid_subject || 'mailto:admin@example.com',
      config.vapid_public_key,
      config.vapid_private_key
    );
  }

  return {
    sendNotification: async (sub: any, payload: string) => {
      const rawP256dh = sub.p256dh || (sub.keys && sub.keys.p256dh);
      const rawAuth = sub.auth || (sub.keys && sub.keys.auth);
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: toBase64Url(rawP256dh),
          auth: toBase64Url(rawAuth)
        }
      };
      return await webpush.sendNotification(pushSubscription, payload, PUSH_OPTIONS);
    }
  };
}
