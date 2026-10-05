// Every encrypted message carries a decoy: the innocuous text shown to anyone who
// has not unlocked the real content. The server replaces this with an
// organization-aware Ollama decoy; these phrases are work-only fallbacks for
// optimistic/offline UI and older backend versions.

const DECOYS = [
  'I will share the project update before the review',
  'Can you confirm the deadline for this task',
  'The client feedback is ready for review',
  'I am checking the numbers before sending the report',
  'The ticket is assigned and the fix is in progress',
  'Please review the draft and add your notes',
  'I will send the updated file after the meeting',
  'The approval is still pending with operations',
  'Can we review the project timeline on the next call',
  'The deployment is complete and the system looks stable',
  'I added the requested changes to the document',
  'The support team is checking the issue now',
];

export function generateDecoy(): string {
  return DECOYS[Math.floor(Math.random() * DECOYS.length)];
}
