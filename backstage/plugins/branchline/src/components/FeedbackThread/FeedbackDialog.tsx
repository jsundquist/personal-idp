import { useApi } from '@backstage/frontend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import Timeline from '@mui/lab/Timeline';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineOppositeContent, {
  timelineOppositeContentClasses,
} from '@mui/lab/TimelineOppositeContent';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import type { FeedbackItem, FeedbackStatus } from '../../types';

/** Which panel the dialog is currently showing. */
export type FeedbackView = 'list' | 'detail' | 'add';

const STATUS_COLOR: Record<FeedbackStatus, 'warning' | 'success' | 'default'> = {
  open: 'warning',
  resolved: 'success',
  exception: 'default',
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  exception: 'Exception',
};

function refName(ref: string): string {
  try {
    return parseEntityRef(ref).name;
  } catch {
    return ref;
  }
}

/** Date line for a comment timestamp, e.g. "1/2/2026". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/** Time line for a comment timestamp, e.g. "12:00 AM". */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 1–2 uppercase initials derived from an entity ref, for the avatar. */
function initials(ref: string): string {
  const name = refName(ref);
  const parts = name.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function StatusChip({ status }: { status: FeedbackStatus }) {
  return (
    <Chip
      size="small"
      label={STATUS_LABEL[status]}
      color={STATUS_COLOR[status]}
      variant={status === 'exception' ? 'outlined' : 'filled'}
    />
  );
}

function FeedbackList({
  items,
  onSelect,
}: {
  items: FeedbackItem[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        No feedback logged for this step.
      </Typography>
    );
  }

  return (
    <List disablePadding>
      {items.map(item => (
        <ListItemButton
          key={item.id}
          onClick={() => onSelect(item.id)}
          sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 1, py: 1.25 }}
        >
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ width: '100%', minWidth: 0 }}>
            <StatusChip status={item.status} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {item.body}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {refName(item.author)}
              </Typography>
            </Box>
            {item.comments.length > 0 && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0, color: 'text.secondary' }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
                <Typography variant="caption">{item.comments.length}</Typography>
              </Stack>
            )}
          </Stack>
        </ListItemButton>
      ))}
    </List>
  );
}

function FeedbackDetail({
  item,
  instanceId,
  canManage,
  onMutated,
}: {
  item: FeedbackItem;
  instanceId: string;
  canManage: boolean;
  onMutated: () => void;
}) {
  const api = useApi(branchlineApiRef);
  const [comment, setComment] = useState('');
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [resolveConfirm, setResolveConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const isOpen = item.status === 'open';

  const submitComment = async () => {
    if (!comment.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.addFeedbackComment(instanceId, item.id, comment.trim());
      setComment('');
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    try {
      await api.closeFeedback(instanceId, item.id, 'resolved');
      setResolveConfirm(false);
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const grantException = async () => {
    if (!exceptionReason.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.closeFeedback(instanceId, item.id, 'exception', exceptionReason.trim());
      setExceptionMode(false);
      setExceptionReason('');
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {/* Original feedback */}
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        <StatusChip status={item.status} />
        <Typography variant="caption" color="text.secondary">
          {refName(item.author)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
        {item.body}
      </Typography>

      {!isOpen && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {item.status === 'resolved' ? 'Resolved' : 'Exception granted'}
          {item.closedBy ? ` by ${refName(item.closedBy)}` : ''}
          {item.status === 'exception' && item.exceptionReason
            ? ` — ${item.exceptionReason}`
            : ''}
        </Typography>
      )}

      {/* Management actions — grouped with the finding, above the comment thread */}
      {canManage && isOpen && (
        <Box sx={{ mt: 1.5 }}>
          {!exceptionMode && !resolveConfirm && (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => setResolveConfirm(true)}
                disabled={busy}
              >
                Resolve
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setExceptionMode(true)}
                disabled={busy}
              >
                Grant Exception
              </Button>
            </Stack>
          )}
          {resolveConfirm && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Resolve this finding? This marks it as addressed and closes the thread to
                further action.
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() => setResolveConfirm(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={resolve}
                  disabled={busy}
                >
                  Confirm Resolve
                </Button>
              </Stack>
            </Box>
          )}
          {exceptionMode && (
            <Box>
              <TextField
                size="small"
                fullWidth
                multiline
                rows={2}
                label="Reason for exception"
                value={exceptionReason}
                onChange={e => setExceptionReason(e.target.value)}
                helperText="Required — explain why this feedback is being waived."
                disabled={busy}
              />
              <Stack direction="row" spacing={1} mt={1}>
                <Button size="small" onClick={() => setExceptionMode(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={grantException}
                  disabled={busy || !exceptionReason.trim()}
                >
                  Confirm Exception
                </Button>
              </Stack>
            </Box>
          )}
        </Box>
      )}

      {/* Comments */}
      <Divider sx={{ my: 1.5 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Comments
      </Typography>
      {item.comments.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No comments yet.
        </Typography>
      ) : (
        <Timeline
          sx={{
            m: 0,
            p: 0,
            [`& .${timelineOppositeContentClasses.root}`]: { flex: 0.35 },
          }}
        >
          {item.comments.map((c, idx) => {
            const isLast = idx === item.comments.length - 1;
            return (
              <TimelineItem key={c.id}>
                <TimelineOppositeContent sx={{ pl: 0 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatDate(c.createdAt)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatTime(c.createdAt)}
                  </Typography>
                </TimelineOppositeContent>
                <TimelineSeparator>
                  <TimelineDot sx={{ p: 0, boxShadow: 'none', bgcolor: 'transparent' }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 13 }}>
                      {initials(c.author)}
                    </Avatar>
                  </TimelineDot>
                  {!isLast && <TimelineConnector />}
                </TimelineSeparator>
                <TimelineContent sx={{ pr: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    {refName(c.author)}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </Typography>
                </TimelineContent>
              </TimelineItem>
            );
          })}
        </Timeline>
      )}

      {/* Add a comment — available to any participant */}
      <Stack direction="row" spacing={1} alignItems="flex-start" mt={1.5}>
        <TextField
          size="small"
          fullWidth
          placeholder="Add a comment…"
          value={comment}
          onChange={e => setComment(e.target.value)}
          disabled={busy}
        />
        <Button size="small" onClick={submitComment} disabled={busy || !comment.trim()}>
          Comment
        </Button>
      </Stack>
    </Box>
  );
}

function FeedbackCompose({
  instanceId,
  taskId,
  onDone,
  onCancel,
}: {
  instanceId: string;
  taskId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi(branchlineApiRef);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.addFeedback(instanceId, taskId, body.trim());
      setBody('');
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        multiline
        rows={3}
        label="What needs to be done?"
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={busy}
      />
      <Stack direction="row" spacing={1} mt={1.5}>
        <Button size="small" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={busy || !body.trim()}
        >
          Log feedback
        </Button>
      </Stack>
    </Box>
  );
}

export function FeedbackDialog({
  open,
  onClose,
  instanceId,
  taskId,
  items,
  loading,
  canManage,
  initialView,
  onMutated,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  taskId: string;
  items: FeedbackItem[];
  loading: boolean;
  canManage: boolean;
  /** Which panel to show when the dialog opens */
  initialView: FeedbackView;
  /** Called after any mutation so the parent can reload the feedback list */
  onMutated: () => void;
}) {
  const [view, setView] = useState<FeedbackView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset to the requested panel each time the dialog opens.
  useEffect(() => {
    if (open) {
      setView(initialView);
      setSelectedId(null);
    }
  }, [open, initialView]);

  const selected = selectedId ? items.find(i => i.id === selectedId) ?? null : null;
  // If the selected item vanished (shouldn't normally happen), fall back to the list.
  const effectiveView = view === 'detail' && !selected ? 'list' : view;

  const title = effectiveView === 'add' ? 'Add feedback' : 'Feedback';

  const renderBody = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      );
    }
    if (effectiveView === 'add') {
      return (
        <FeedbackCompose
          instanceId={instanceId}
          taskId={taskId}
          onDone={() => {
            onMutated();
            setView('list');
          }}
          onCancel={() => setView('list')}
        />
      );
    }
    if (effectiveView === 'detail' && selected) {
      return (
        <FeedbackDetail
          item={selected}
          instanceId={instanceId}
          canManage={canManage}
          onMutated={onMutated}
        />
      );
    }
    return (
      <FeedbackList
        items={items}
        onSelect={id => {
          setSelectedId(id);
          setView('detail');
        }}
      />
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          height: '70vh',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {effectiveView !== 'list' && (
            <IconButton
              size="small"
              edge="start"
              onClick={() => setView('list')}
              aria-label="Back to feedback list"
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          )}
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
            {title}
          </Typography>
          {effectiveView === 'list' && canManage && (
            <Button size="small" variant="contained" onClick={() => setView('add')}>
              Add feedback
            </Button>
          )}
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <DialogContent sx={{ p: effectiveView === 'list' ? 0 : 2, flex: 1, overflowY: 'auto' }}>
        {renderBody()}
      </DialogContent>
    </Dialog>
  );
}
