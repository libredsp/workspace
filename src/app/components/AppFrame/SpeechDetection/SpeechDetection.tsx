import React, { useState } from 'react'
import { Panel } from './Panel';
import { LogisticRegressionModel } from '../../core/speech/logistic_regression';

export const SpeechDetection = () => {
    const [model, setModel] = useState<LogisticRegressionModel | null>(null);

    return (
        <div className="flex flex-col flex-1 items-stretch">
            <div className="flex">
                <Panel model={model} updateModel={setModel} />
            </div>
        </div>
    )
}