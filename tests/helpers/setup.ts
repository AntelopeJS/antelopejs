import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';

chai.use(sinonChai);

export const { expect } = chai;

// Export sinon for convenience
export { sinon };
