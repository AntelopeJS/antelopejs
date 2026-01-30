import sinon, { SinonStub } from 'sinon';
import inquirer from 'inquirer';

export interface InquirerMockContext {
  stub: SinonStub;
  setAnswers: (answers: Record<string, any>) => void;
  setAnswersSequence: (answersSequence: Record<string, any>[]) => void;
  restore: () => void;
}

export function createMockInquirer(): InquirerMockContext {
  let currentAnswers: Record<string, any> = {};
  let answersSequence: Record<string, any>[] = [];
  let callIndex = 0;

  const stub = sinon.stub(inquirer, 'prompt').callsFake(async (questions: any) => {
    // If we have a sequence, use the next set of answers
    if (answersSequence.length > 0) {
      const answers = answersSequence[callIndex] || answersSequence[answersSequence.length - 1];
      callIndex++;
      return answers;
    }

    // Otherwise use the static answers
    // Extract the question names and return matching answers
    const questionList = Array.isArray(questions) ? questions : [questions];
    const result: Record<string, any> = {};

    for (const q of questionList) {
      const name = q.name;
      if (name && name in currentAnswers) {
        result[name] = currentAnswers[name];
      } else if (name && 'default' in q) {
        result[name] = q.default;
      }
    }

    return result;
  });

  return {
    stub,
    setAnswers: (answers: Record<string, any>) => {
      currentAnswers = answers;
      answersSequence = [];
      callIndex = 0;
    },
    setAnswersSequence: (sequence: Record<string, any>[]) => {
      answersSequence = sequence;
      callIndex = 0;
    },
    restore: () => {
      stub.restore();
    },
  };
}
