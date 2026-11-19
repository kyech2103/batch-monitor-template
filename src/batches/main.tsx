// 배치 등록 화면을 새 창(sub_batches/Index.html)으로 열었을 때의 진입점. 메인 창 안에서는 src/batches/BatchDialog.tsx
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sb } from '../sb';
import { batchSync } from '../main/batches';
import { checkSubAppLogin } from '../subapp/gate';
import { BatchForm } from './BatchForm';
import { applyStoredWatermark } from '../watermark';

applyStoredWatermark();

function App() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => { checkSubAppLogin(sb, () => { batchSync.start(); setAllowed(true); }); }, []);
  return <BatchForm allowed={allowed} />;
}

createRoot(document.getElementById('root')!).render(<App />);
