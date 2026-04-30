export const PALETTE = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#a78bfa',
  '#22d3ee', '#fb923c', '#4ade80', '#f472b6', '#facc15',
];

export const BRAND_COLOR: Record<string, string> = {
  sony: '#60a5fa',
  sigma: '#f87171',
  tamron: '#4ade80',
  zeiss: '#facc15',
  samyang: '#c084fc',
  viltrox: '#22d3ee',
  ttartisan: '#fb923c',
  laowa: '#86efac',
  voigtlander: '#a5b4fc',
};

export const BRAND_DISPLAY: Record<string, string> = {
  sony: 'Sony',
  tamron: 'Tamron',
  sigma: 'Sigma',
  samyang: 'Samyang',
  viltrox: 'Viltrox',
  laowa: 'Laowa',
  zeiss: 'Zeiss',
  ttartisan: 'TTArtisan',
  voigtlander: 'Voigtlander',
};

export const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','shall','can','this','that','these',
  'those','i','my','me','we','our','you','your','it','its','he','she','they','their',
  'what','which','who','how','when','where','why','not','no','so','if','as','up',
  'just','about','out','more','also','some','any','all','than','then','there','here',
  'like','get','got','im','ive','use','using','used','one','two',
  'new','first','best','good','great','really','very','much','only','still','back',
  'after','before','into','over','through','between','own','same','other','such',
  'need','want','think','know','see','look','go','going','take','took','time','way',
]);
