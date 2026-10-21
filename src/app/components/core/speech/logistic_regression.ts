export const NUM_FEATURES = 7;

export type LogisticRegressionModel = { weights: number[] };

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const parseModel = (text: string): LogisticRegressionModel => {
    const weights = text.split(/\s+/).filter(Boolean).map(Number);
    if (weights.length === 0 || weights.some((w) => !Number.isFinite(w))) {
        throw new Error("The model file must contain whitespace-separated numbers.");
    }
    if (weights.length !== NUM_FEATURES + 1) {
        throw new Error(`Expected ${NUM_FEATURES + 1} weights (bias + ${NUM_FEATURES} features), got ${weights.length}.`);
    }
    return { weights };
};

export const predictProbability = (model: LogisticRegressionModel, x: number[]) => {
    let z = model.weights[0];
    for (let j = 0; j < x.length; j++) z += model.weights[j + 1] * x[j];
    return sigmoid(z);
};