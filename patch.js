const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'packages/web/components/ChatRoom.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const oldMap = `{messages.map((m) => {
          const mentionsYou = Boolean(user && messageMentionsUser(m, user.userId));
          const mentionUnread = pendingMentionIds.includes(m.id);
          return (
          <div
            key={m.id}
            id={\`loop-msg-\${m.id}\`}
            style={{
              marginBottom: 16,
              scrollMarginTop: 80,
            }}
          >
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, justifyContent: m.sender.id === user?.userId ? 'flex-end' : 'flex-start' }}>
              <span>
                {m.sender.displayName} · {m.phase}
                {m.content.type !== 'text' &&
                  m.content.type !== 'progress' &&
                  \` · \${m.content.type}\`}
                {m.content.type === 'progress' && ' · 进度'}
              </span>
              {mentionsYou && (
                <span
                  className="mention-you-pill"
                  style={{ fontSize: 11, padding: '1px 6px' }}
                >
                  提及你
                </span>
              )}
            </div>`;

const newMap = `{messages.map((m, index) => {
          const mentionsYou = Boolean(user && messageMentionsUser(m, user.userId));
          const mentionUnread = pendingMentionIds.includes(m.id);
          
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const isSameSenderAsPrev = prevMessage && prevMessage.sender.id === m.sender.id && prevMessage.sender.type !== 'system' && m.sender.type !== 'system';
          
          return (
          <div
            key={m.id}
            id={\`loop-msg-\${m.id}\`}
            style={{
              marginBottom: isSameSenderAsPrev ? 4 : 16,
              scrollMarginTop: 80,
            }}
          >
            {!isSameSenderAsPrev && (
              <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, justifyContent: m.sender.id === user?.userId ? 'flex-end' : 'flex-start' }}>
                <span>
                  {m.sender.displayName} · {m.phase}
                  {m.content.type !== 'text' &&
                    m.content.type !== 'progress' &&
                    \` · \${m.content.type}\`}
                  {m.content.type === 'progress' && ' · 进度'}
                </span>
                {mentionsYou && (
                  <span
                    className="mention-you-pill"
                    style={{ fontSize: 11, padding: '1px 6px' }}
                  >
                    提及你
                  </span>
                )}
              </div>
            )}`;

content = content.replace(oldMap, newMap);
fs.writeFileSync(filePath, content, 'utf8');
