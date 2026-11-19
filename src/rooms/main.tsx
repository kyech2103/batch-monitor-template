// 선반·창고 화면을 새 창(sub_toolroom 등)으로 열었을 때의 진입점. 어느 방인지는 <body data-room>. 메인 창 안에서는 RoomDialogs.tsx
import { createRoot } from 'react-dom/client';
import { sb } from '../sb';
import { checkSubAppLogin } from '../subapp/gate';
import { RoomApp } from './RoomDialogs';
import { roomById } from './rooms';
import { applyStoredWatermark } from '../watermark';

applyStoredWatermark();

const room = roomById(document.body.dataset.room || '');
checkSubAppLogin(sb, () => createRoot(document.getElementById('root')!).render(<RoomApp room={room} />));
