const ADJECTIVES = [
  "restless", "quiet", "hidden", "stubborn", "patient", "distant", "steady",
  "curious", "weary", "bright", "faint", "bold", "calm", "sharp", "drifting",
];

const NOUNS = [
  "comet", "harbor", "signal", "current", "ember", "lantern", "ridge",
  "tunnel", "compass", "orbit", "thicket", "anchor", "canyon", "tide",
];

export function generatePublicAlias(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(100 + Math.random() * 900);
  return `${adjective}-${noun}-${number}`;
}
