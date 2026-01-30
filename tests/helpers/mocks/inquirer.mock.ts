import sinon, { SinonStub } from 'sinon';
import inquirer from 'inquirer';

/**
 * Interface for the mock inquirer context
 * Provides methods to control mock behavior and access the stub
 */
export interface MockInquirer {
  /** The sinon stub for inquirer.prompt */
  prompt: SinonStub;
  /** Set static answers by question name */
  setAnswers: (answers: Record<string, any>) => void;
  /** Set sequential answers for multi-prompt flows */
  setSequentialAnswers: (answers: Record<string, any>[]) => void;
  /** Reset call count for sequential answers */
  resetCallCount: () => void;
  /** Get current call count */
  getCallCount: () => number;
}

/**
 * @deprecated Use MockInquirer instead
 */
export interface InquirerMockContext extends MockInquirer {
  /** @deprecated Use prompt instead */
  stub: SinonStub;
  /** @deprecated Use setSequentialAnswers instead */
  setAnswersSequence: (answersSequence: Record<string, any>[]) => void;
  /** Restore the original inquirer.prompt */
  restore: () => void;
}

/**
 * Get the default value for a question based on its type
 */
function getDefaultForQuestion(question: any): any {
  // If explicit default is provided, use it
  if ('default' in question) {
    return question.default;
  }

  // Type-specific defaults
  switch (question.type) {
    case 'confirm':
      return false;
    case 'checkbox':
      return [];
    case 'list':
      // For list, return the first choice's value if available
      if (question.choices && question.choices.length > 0) {
        const firstChoice = question.choices[0];
        // Choices can be objects with value property or plain strings
        return typeof firstChoice === 'object' && 'value' in firstChoice ? firstChoice.value : firstChoice;
      }
      return '';
    case 'input':
    case 'password':
    default:
      return '';
  }
}

/**
 * Creates a mock for inquirer that supports:
 * - Sequential answers for multi-prompt flows
 * - Named prompts support (answers by question name)
 * - Default value handling for different question types (list, checkbox, confirm, input)
 */
export function createMockInquirer(): InquirerMockContext {
  let staticAnswers: Record<string, any> = {};
  let sequentialAnswers: Record<string, any>[] = [];
  let callCount = 0;

  const stub = sinon.stub(inquirer, 'prompt').callsFake(async (questions: any) => {
    // Normalize questions to array
    const questionList = Array.isArray(questions) ? questions : [questions];

    // If we have sequential answers, use them in order
    if (sequentialAnswers.length > 0) {
      // Use the next set of answers, or fall back to the last one if exhausted
      const answers = sequentialAnswers[callCount] || sequentialAnswers[sequentialAnswers.length - 1];
      callCount++;

      // Merge with defaults for any missing question answers
      const result: Record<string, any> = {};
      for (const q of questionList) {
        const name = q.name;
        if (name && name in answers) {
          result[name] = answers[name];
        } else if (name) {
          result[name] = getDefaultForQuestion(q);
        }
      }
      return result;
    }

    // Otherwise use static answers by question name
    const result: Record<string, any> = {};
    for (const question of questionList) {
      const name = question.name;
      if (!name) continue;

      if (name in staticAnswers) {
        result[name] = staticAnswers[name];
      } else {
        result[name] = getDefaultForQuestion(question);
      }
    }
    return result;
  });

  const setAnswers = (answers: Record<string, any>) => {
    staticAnswers = answers;
    sequentialAnswers = [];
    callCount = 0;
  };

  const setSequentialAnswers = (answers: Record<string, any>[]) => {
    sequentialAnswers = answers;
    staticAnswers = {};
    callCount = 0;
  };

  const resetCallCount = () => {
    callCount = 0;
  };

  const getCallCount = () => callCount;

  return {
    // MockInquirer interface
    prompt: stub,
    setAnswers,
    setSequentialAnswers,
    resetCallCount,
    getCallCount,

    // Legacy InquirerMockContext interface (deprecated)
    stub,
    setAnswersSequence: setSequentialAnswers,
    restore: () => {
      stub.restore();
    },
  };
}
