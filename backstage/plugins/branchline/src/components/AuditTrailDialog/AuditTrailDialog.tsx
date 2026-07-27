import { useApi } from '@backstage/frontend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import BlockIcon from '@mui/icons-material/Block';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { AuditEventType } from '../../types';
import type { AuditEvent, WorkflowInstance } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  workflow: WorkflowInstance;
}

interface EventStyle {
  icon: ReactNode;
  color: string;
  title: string;
}

function refName(ref?: string): string {
  if (!ref) {
    return 'Unknown';
  }
  try {
    return parseEntityRef(ref).name;
  } catch {
    return ref;
  }
}

function describe(event: AuditEvent, taskLabel: (id?: string) => string): EventStyle {
  const on = event.taskId ? ` · ${taskLabel(event.taskId)}` : '';
  switch (event.type) {
    case AuditEventType.WorkflowStarted:
      return { icon: <PlayArrowIcon fontSize="small" />, color: 'primary.main', title: 'Workflow started' };
    case AuditEventType.WorkflowCompleted:
      return { icon: <FlagIcon fontSize="small" />, color: 'success.main', title: 'Workflow completed' };
    case AuditEventType.WorkflowCancelled:
      return { icon: <CancelIcon fontSize="small" />, color: 'error.main', title: 'Workflow cancelled' };
    case AuditEventType.TaskCompleted:
      return { icon: <CheckCircleIcon fontSize="small" />, color: 'success.main', title: `Step completed${on}` };
    case AuditEventType.TaskSkipped:
      return { icon: <BlockIcon fontSize="small" />, color: 'warning.main', title: `Step skipped${on}` };
    case AuditEventType.FeedbackCreated:
      return { icon: <FeedbackOutlinedIcon fontSize="small" />, color: 'info.main', title: `Feedback logged${on}` };
    case AuditEventType.FeedbackResolved:
      return { icon: <CheckCircleIcon fontSize="small" />, color: 'success.main', title: `Feedback resolved${on}` };
    case AuditEventType.FeedbackException:
      return { icon: <RemoveCircleOutlineIcon fontSize="small" />, color: 'text.secondary', title: `Exception granted${on}` };
    default:
      return { icon: <FeedbackOutlinedIcon fontSize="small" />, color: 'text.secondary', title: event.type };
  }
}

export function AuditTrailDialog({ open, onClose, workflow }: Props) {
  const api = useApi(branchlineApiRef);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const labelByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const block of workflow.parallelBlocks ?? []) {
      for (const step of block.steps) {
        for (const task of step.tasks) {
          map.set(task.id, task.label);
        }
      }
    }
    return map;
  }, [workflow.parallelBlocks]);

  const taskLabel = (id?: string) => (id ? labelByTaskId.get(id) ?? id : '');

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    api
      .getAuditTrail(workflow.id)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { maxHeight: '90vh' } }}>
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Audit Trail
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {workflow.title}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ mt: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {!loading && events.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No activity recorded yet.
          </Typography>
        )}
        {!loading &&
          events.map((event, idx) => {
            const style = describe(event, taskLabel);
            const isLast = idx === events.length - 1;
            return (
              <Stack key={`${event.type}-${event.timestamp}-${idx}`} direction="row" spacing={1.5}>
                {/* Timeline gutter: icon + connector line */}
                <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: style.color,
                      border: '1px solid',
                      borderColor: style.color,
                    }}
                  >
                    {style.icon}
                  </Box>
                  {!isLast && <Box sx={{ flex: 1, width: '1px', bgcolor: 'divider', my: 0.5 }} />}
                </Stack>

                {/* Content */}
                <Box sx={{ pb: isLast ? 0 : 2.5, pt: 0.25, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {style.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {refName(event.actor)} · {new Date(event.timestamp).toLocaleString()}
                  </Typography>
                  {event.detail && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      fontStyle="italic"
                      sx={{ display: 'block', mt: 0.25, whiteSpace: 'pre-wrap' }}
                    >
                      {event.detail}
                    </Typography>
                  )}
                </Box>
              </Stack>
            );
          })}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
