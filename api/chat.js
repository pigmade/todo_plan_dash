// Vercel Serverless Function — Gemini API 프록시
// 브라우저에 API 키를 노출하지 않기 위해 서버(이 함수)에서만 GEMINI_API_KEY를 사용합니다.
// 배포 시 Vercel 프로젝트 Settings > Environment Variables 에 GEMINI_API_KEY를 등록하세요.

// 프레임워크 미지정 프로젝트에서는 `vercel dev`가 .env.local을 함수에 자동 주입하지 않으므로
// 로컬 개발 시에만 직접 로드한다. 프로덕션은 Vercel이 이미 process.env에 주입하므로 조용히 무시된다.
try {
  process.loadEnvFile(require('path').join(__dirname, '..', '.env.local'));
} catch (_) {}

const MODEL = 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_INSTRUCTION =
  '너는 "오늘의 할 일"이라는 할 일 관리 웹앱 우측 하단에 떠 있는 도우미 챗봇이다. ' +
  '친절하고 간결하게 한국어로 답한다. 답변은 너무 길지 않게 핵심 위주로 작성한다.';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되어 있지 않습니다.' });
    return;
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    return;
  }

  const contents = messages
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .slice(-20) // 최근 20개 메시지만 컨텍스트로 전달
    .map(m => ({
      role: m.role === 'bot' ? 'model' : 'user',
      parts: [{ text: m.text.slice(0, 4000) }],
    }));

  if (contents.length === 0) {
    res.status(400).json({ error: '유효한 메시지가 없습니다.' });
    return;
  }

  try {
    const upstream = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: data?.error?.message || 'Gemini API 오류' });
      return;
    }

    const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    if (!reply) {
      res.status(502).json({ error: '응답을 생성하지 못했습니다.' });
      return;
    }

    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: '서버 오류: ' + err.message });
  }
};
