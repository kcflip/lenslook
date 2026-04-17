import lensData from "../lenses.json" with { type: "json" };

interface Lens {
  id: string;
  brand: string;
  name: string;
  model: string;
  focalLength: string;
  maxAperture: string;
  mount: string;
  aliases: string[];
}

const lenses = lensData as Lens[];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

const lensTokens: { lens: Lens; tokens: string[] }[] = lenses.map((lens) => ({
  lens,
  tokens: [lens.name, lens.model, ...lens.aliases].map(normalize),
}));

export function matchLenses(title: string): string[] {
  const norm = normalize(title);
  const matched = new Set<string>();

  for (const { lens, tokens } of lensTokens) {
    for (const token of tokens) {
      if (norm.includes(token)) {
        matched.add(lens.id);
        break;
      }
    }
  }

  return [...matched];
}
