import { ConfigReader } from '@backstage/config';
import { CandidateGroupResolver } from './CandidateGroupResolver';

describe('CandidateGroupResolver', () => {
  it('returns [] when no config is present (self-serve)', () => {
    const resolver = new CandidateGroupResolver(new ConfigReader({}));
    expect(resolver.resolve('create-backend-api', 'Request Architecture Review')).toEqual([]);
  });

  it('resolves groups for a matching definitionId + taskId pair', () => {
    const resolver = new CandidateGroupResolver(
      new ConfigReader({
        branchline: {
          stepFunctions: {
            candidateGroups: [
              {
                definitionId: 'create-backend-api',
                taskId: 'Request Architecture Review',
                groups: ['architects'],
              },
            ],
          },
        },
      }),
    );
    expect(resolver.resolve('create-backend-api', 'Request Architecture Review')).toEqual([
      'architects',
    ]);
  });

  it('returns [] for a task with no matching entry (self-serve)', () => {
    const resolver = new CandidateGroupResolver(
      new ConfigReader({
        branchline: {
          stepFunctions: {
            candidateGroups: [
              {
                definitionId: 'create-backend-api',
                taskId: 'Request Architecture Review',
                groups: ['architects'],
              },
            ],
          },
        },
      }),
    );
    expect(resolver.resolve('create-backend-api', 'Some Other Task')).toEqual([]);
  });
});
