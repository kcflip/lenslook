declare module 'wordcloud' {
  type WeightFactor = number | ((size: number) => number);
  type ColorFunc = string | ((word: string, weight: number, fontSize: number, distance: number, theta: number) => string);

  interface WordCloudOptions {
    list: [string, number][];
    gridSize?: number;
    weightFactor?: WeightFactor;
    fontFamily?: string;
    color?: ColorFunc;
    backgroundColor?: string;
    rotateRatio?: number;
    rotationSteps?: number;
    minSize?: number;
    shuffle?: boolean;
    [key: string]: unknown;
  }

  function WordCloud(canvas: HTMLCanvasElement | HTMLElement, options: WordCloudOptions): void;
  export default WordCloud;
}
