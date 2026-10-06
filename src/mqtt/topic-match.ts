/**
 * Does `pattern` (an ACL rule, may contain + and #) cover `topic`?
 * `topic` may itself be a subscription filter: a `+` there is only covered by `+` or `#`
 * in the pattern, and a `#` only by a `#`, so a rule can't be widened by subscribing broader.
 */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split('/');
  const t = topic.split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '#') return true;
    if (i >= t.length) return false;
    if (t[i] === '#') return false;
    if (p[i] === '+') continue;
    if (p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}
