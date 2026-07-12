// Every encrypted message carries a decoy: the innocuous text shown to anyone who
// has not unlocked the real content. It must read like an ordinary message — never
// announce that ciphertext exists — so it is generated client-side and sent with
// the message. If we omit it, the server substitutes its own text.

const DECOYS = [
  'hey are you free tonight',
  'what are you up to later',
  'just wanted to check in with you',
  'hope everything is going well with you',
  'did you eat anything yet today',
  'have so much work piled up right now',
  'call me back when you get a chance',
  'running a bit late, sorry about that',
  'let me know when you get home',
  'thanks again for earlier, appreciate it',
  'are we still on for the weekend',
  'that place was better than I expected',
  'forgot to mention it yesterday',
  'weather has been awful all week',
  'send me the address when you can',
  'no rush, whenever you are free',
];

export function generateDecoy(): string {
  return DECOYS[Math.floor(Math.random() * DECOYS.length)];
}
