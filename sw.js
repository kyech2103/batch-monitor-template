'use strict';

const APP_URL = '/';
const PUSH_TODO_URL = '/#m=todo';
const NOTIFICATION_ICON = '/icons/icon-192.png';
importScripts('/js/config.js'); // SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY
const PUSH_FUNCTION_URL = SUPABASE_URL + '/functions/v1/todo-push';
const SUPABASE_PUBLISHABLE_KEY = SUPABASE_KEY;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = (data && data.title) || '⏰ 작업 알림';
  const options = {
    body: (data && data.body) || '',
    tag: (data && data.tag) || 'todo-alert',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    data: { url: PUSH_TODO_URL }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(PUSH_TODO_URL);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    // oldSubscription이 없는 브라우저도 있어 VAPID 키를 직접 넘긴다(키 없이는 구독이 거부됨)
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })
      .then((newSub) => {
        return fetch(PUSH_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({
            action: 'resubscribe',
            old_endpoint: event.oldSubscription ? event.oldSubscription.endpoint : '',
            old_auth: event.oldSubscription ? event.oldSubscription.toJSON().keys.auth : '',
            subscription: newSub ? newSub.toJSON() : {}
          })
        });
      })
      .catch(() => {})
  );
});
