// 觀察資料夾雜湊（規劃書 4.12、附錄 A observe）：正規化絕對路徑嘅 SHA-256。
// 伺服器（計新增資料夾嘅雜湊）、外殼同每個轉接層觀測程式都要用同一算法；轉接層各自抄一份（轉接層唔 import 核心），由測試核對一致。
// 正規化：絕對路徑、反斜線轉正斜線、去尾斜線；Windows 大小寫不分，所以全部轉細楷。
import crypto from 'node:crypto';
import path from 'node:path';

export const normFolder = p => { const s = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s; };
export const folderHash = p => crypto.createHash('sha256').update(normFolder(p)).digest('hex');
