import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { TaskItem } from '../TaskItem';
import type { Step } from '../../types';

interface StepViewProps {
  step: Step;
  instanceId: string;
  canAct: boolean;
  blockedBy?: string;
  onComplete: (taskId: string) => Promise<void>;
  onSkip: (taskId: string, reason: string) => Promise<void>;
}

export function StepView({ step, instanceId, canAct, blockedBy, onComplete, onSkip }: StepViewProps) {
  const isParallel = step.parallelTasks && step.tasks.length > 1;
  const isBlocked = Boolean(blockedBy);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {isParallel && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label="Parallel"
            size="small"
            variant="outlined"
            color="info"
            sx={{ fontSize: '0.65rem', height: 18 }}
          />
        </Box>
      )}
      {isParallel ? (
        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1 }}>
          {step.tasks.map((task, i) => (
            <Box key={task.id} sx={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
              {i > 0 && <Divider orientation="vertical" flexItem />}
              <Box sx={{ flex: 1 }}>
                <TaskItem
                  task={task}
                  instanceId={instanceId}
                  canAct={canAct && !isBlocked}
                  blockedBy={blockedBy}
                  onComplete={onComplete}
                  onSkip={onSkip}
                />
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        step.tasks.map(task => (
          <TaskItem
            key={task.id}
            task={task}
            instanceId={instanceId}
            canAct={canAct && !isBlocked}
            blockedBy={blockedBy}
            onComplete={onComplete}
            onSkip={onSkip}
          />
        ))
      )}
    </Box>
  );
}
