import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { StatusBadge } from '../StatusBadge';
import { StepView } from '../StepView';
import type { ParallelBlock as ParallelBlockType, TaskStatus } from '../../types';

interface ParallelBlockProps {
  block: ParallelBlockType;
  phaseNumber: number;
  instanceId: string;
  canAct: boolean;
  defaultExpanded?: boolean;
  onComplete: (taskId: string) => Promise<void>;
  onSkip: (taskId: string, reason: string) => Promise<void>;
}

export function derivePhaseStatus(block: ParallelBlockType): TaskStatus {
  const allTasks = block.steps.flatMap(s => s.tasks);
  if (allTasks.length === 0) return 'pending';
  if (allTasks.every(t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken'))
    return 'completed';
  if (allTasks.some(t => t.status === 'active')) return 'active';
  return 'pending';
}

export function ParallelBlock({
  block,
  phaseNumber,
  instanceId,
  canAct,
  defaultExpanded,
  onComplete,
  onSkip,
}: ParallelBlockProps) {
  const phaseStatus = derivePhaseStatus(block);
  const [expanded, setExpanded] = useState(defaultExpanded ?? phaseStatus === 'active');

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, isExpanded) => setExpanded(isExpanded)}
      variant="outlined"
      disableGutters
      sx={{ '&:before': { display: 'none' } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ backgroundColor: 'action.hover', minHeight: 48 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, mr: 1 }}>
          <Chip
            label={`Phase ${phaseNumber}`}
            size="small"
            color={phaseStatus === 'active' ? 'primary' : 'default'}
            variant={phaseStatus === 'active' ? 'filled' : 'outlined'}
            sx={{ fontWeight: 'bold', fontSize: '0.7rem' }}
          />
          <Typography variant="subtitle1" fontWeight="medium" sx={{ flexGrow: 1 }}>
            {block.label}
          </Typography>
          <StatusBadge status={phaseStatus} size="small" />
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {block.steps.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No steps defined for this phase.
          </Typography>
        ) : (
          block.steps.map((step, idx) => {
            // A step is blocked if a previous step isn't done AND this step has no active tasks
            const stepHasActiveTasks = step.tasks.some(t => t.status === 'active');
            const blockedByStep = stepHasActiveTasks
              ? undefined
              : block.steps.slice(0, idx).find(prev => {
                  const allDone = prev.tasks.every(
                    t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken',
                  );
                  return !allDone;
                });

            return (
              <StepView
                key={step.id}
                step={step}
                instanceId={instanceId}
                canAct={canAct}
                blockedBy={blockedByStep?.label}
                onComplete={onComplete}
                onSkip={onSkip}
              />
            );
          })
        )}
      </AccordionDetails>
    </Accordion>
  );
}
