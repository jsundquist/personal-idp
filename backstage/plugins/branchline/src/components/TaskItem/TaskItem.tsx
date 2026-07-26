import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { StatusBadge } from '../StatusBadge';
import type { Task } from '../../types';

interface TaskItemProps {
  task: Task;
  instanceId: string;
  canAct: boolean;
  blockedBy?: string;
  onComplete: (taskId: string) => Promise<void>;
  onSkip: (taskId: string, reason: string) => Promise<void>;
}

export function TaskItem({
  task,
  instanceId: _instanceId,
  canAct,
  blockedBy,
  onComplete,
  onSkip,
}: TaskItemProps) {
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipError, setSkipError] = useState('');
  const [loading, setLoading] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  const isActionable = canAct && task.status === 'active';

  const handleComplete = async () => {
    setLoading(true);
    try {
      await onComplete(task.id);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipSubmit = async () => {
    if (!skipReason.trim()) {
      setSkipError('A reason is required to skip a task.');
      return;
    }
    setLoading(true);
    try {
      await onSkip(task.id, skipReason.trim());
      setSkipOpen(false);
      setSkipReason('');
      setSkipError('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper' }}>
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 1.5,
      }}
    >
      <StatusBadge status={task.status} />
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
          {task.label}
        </Typography>
        {task.documentation && (
          <Typography
            variant="caption"
            color="primary"
            component="span"
            sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
            onClick={() => setDocOpen(o => !o)}
          >
            {docOpen ? 'Hide details' : 'Show details'}
            <IconButton size="small" sx={{ p: 0 }}>
              {docOpen ? <ExpandLessIcon fontSize="inherit" /> : <ExpandMoreIcon fontSize="inherit" />}
            </IconButton>
          </Typography>
        )}
        {blockedBy && (
          <Typography variant="caption" color="text.disabled">
            Blocked by: {blockedBy}
          </Typography>
        )}
        {task.status === 'completed' && task.completedBy && (
          <Typography variant="caption" color="text.secondary">
            Completed by {task.completedBy} at{' '}
            {new Date(task.completedAt!).toLocaleString()}
          </Typography>
        )}
        {(task.status === 'skipped' || task.status === 'not-taken') && task.skippedBy && (
          <Tooltip title={task.skipReason ?? ''} placement="top">
            <Typography
              variant="caption"
              color="warning.main"
              sx={{ cursor: 'help' }}
            >
              {task.status === 'not-taken' ? 'Not taken' : 'Skipped'} by {task.skippedBy} at{' '}
              {new Date(task.skippedAt!).toLocaleString()}
              {task.skipReason ? ` — ${task.skipReason}` : ''}
            </Typography>
          </Tooltip>
        )}
      </Box>

      {isActionable && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled={loading}
            onClick={handleComplete}
          >
            Complete
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={loading}
            onClick={() => setSkipOpen(true)}
          >
            Skip
          </Button>
        </Box>
      )}

    </Box>
    {task.documentation && (
      <Collapse in={docOpen}>
        <Box
          sx={{
            px: 2,
            pb: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            '& h1, & h2, & h3': { fontSize: '0.85rem', fontWeight: 'bold', mt: 1, mb: 0.5 },
            '& p': { fontSize: '0.8rem', mt: 0, mb: 0.75 },
            '& ul, & ol': { fontSize: '0.8rem', pl: 2, mt: 0, mb: 0.75 },
            '& code': { fontSize: '0.75rem', backgroundColor: 'action.hover', borderRadius: 0.5, px: 0.5 },
            '& pre': { fontSize: '0.75rem', backgroundColor: 'action.hover', borderRadius: 1, p: 1, overflow: 'auto' },
          }}
        >
          <ReactMarkdown>{task.documentation}</ReactMarkdown>
        </Box>
      </Collapse>
    )}

      <Dialog
        open={skipOpen}
        onClose={() => setSkipOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Skip Task: {task.label}</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={3}
            fullWidth
            label="Reason for skipping"
            value={skipReason}
            onChange={e => {
              setSkipReason(e.target.value);
              setSkipError('');
            }}
            error={Boolean(skipError)}
            helperText={
              skipError || 'Required — explain why this task is being skipped.'
            }
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSkipSubmit}
            variant="contained"
            color="warning"
            disabled={loading || !skipReason.trim()}
          >
            Skip Task
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
