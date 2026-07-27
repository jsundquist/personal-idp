import { useApi } from '@backstage/frontend-plugin-api';
import { usePermission } from '@backstage/plugin-permission-react';
import { branchlineWorkflowActPermission } from '@internal/backstage-plugin-branchline-common';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CancelIcon from '@mui/icons-material/Cancel';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CloseIcon from '@mui/icons-material/Close';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams } from 'react-router-dom';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { derivePhaseStatus } from '../../components/ParallelBlock';
import { FeedbackThread } from '../../components/FeedbackThread';
import { StatusBadge } from '../../components/StatusBadge';
import { WorkflowFlowDialog } from '../../components/WorkflowFlowDialog';
import type { ParallelBlock, Step as WorkflowStep, Task, WorkflowInstance } from '../../types';
import { parseEntityRef } from '@backstage/catalog-model';

interface ActionTarget {
  task: Task;
  blockLabel: string;
}

function getBlockedByStep(block: ParallelBlock, stepIdx: number): WorkflowStep | undefined {
  return block.steps.slice(0, stepIdx).findLast(prev =>
    !prev.tasks.every(
      t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken',
    ),
  );
}

function TaskRow({
  task,
  blockedByLabel,
  onTakeAction,
}: {
  task: Task;
  blockedByLabel?: string;
  onTakeAction: () => void;
}) {
  const isBlocked = !!blockedByLabel;
  const isActionable = !isBlocked && task.status === 'active';
  const feedback = task.feedbackCounts;
  const hasFeedback = !!feedback && feedback.total > 0;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.75, opacity: isBlocked ? 0.6 : 1, '&:not(:last-child)': { mb: 1 } }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={1.25} mb={0.75}>
        <Box sx={{ flexShrink: 0, mt: 0.15 }}>
          {isBlocked ? (
            <Tooltip title={`Blocked by: ${blockedByLabel}`}>
              <LockIcon fontSize="small" color="disabled" />
            </Tooltip>
          ) : (
            <PersonIcon fontSize="small" color="action" />
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} lineHeight={1.3}>
            {task.label}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
          {hasFeedback && (
            <Chip
              size="small"
              variant="outlined"
              color={feedback!.open > 0 ? 'warning' : 'success'}
              icon={<FeedbackOutlinedIcon />}
              label={
                feedback!.open > 0
                  ? `${feedback!.open} of ${feedback!.total} open`
                  : `${feedback!.total} feedback`
              }
            />
          )}
          <StatusBadge status={task.status} />
        </Stack>
      </Stack>

      {isBlocked && (
        <Stack direction="row" spacing={0.75} mb={0.5}>
          <Chip
            size="small"
            variant="outlined"
            icon={<LockIcon />}
            label={`Blocked by: ${blockedByLabel}`}
            color="warning"
          />
        </Stack>
      )}

      {(task.completedBy || task.skippedBy) && (
        <Box sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider', mb: isActionable ? 1 : 0 }}>
          {task.status === 'skipped' || task.status === 'not-taken' ? (
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <AccountCircleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  Skipped by <strong>{parseEntityRef(task.skippedBy ?? '').name ?? parseEntityRef(task.completedBy ?? '').name}</strong>
                </Typography>
                {task.skippedAt && (
                  <>
                    <CalendarTodayIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary">
                      {new Date(task.skippedAt).toLocaleString()}
                    </Typography>
                  </>
                )}
              </Stack>
              {task.skipReason && (
                <Typography
                  variant="caption"
                  color="warning.dark"
                  fontStyle="italic"
                  sx={{ pl: 2.5 }}
                >
                  Reason: {task.skipReason}
                </Typography>
              )}
            </Stack>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Stack direction="row" spacing={0.75} alignItems="center">
                <AccountCircleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  Completed by <strong>{parseEntityRef(task.completedBy ?? '').name}</strong>
                </Typography>
              </Stack>
              {task.completedAt && (
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <CalendarTodayIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(task.completedAt).toLocaleString()}
                  </Typography>
                </Stack>
              )}
            </Stack>
          )}
        </Box>
      )}

      {(isActionable || task.documentation || hasFeedback) && (
        <Box
          sx={{
            pt: task.completedBy || task.skippedBy ? 0 : 1,
            borderTop: task.completedBy || task.skippedBy ? 'none' : '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button
            size="small"
            variant="outlined"
            color="primary"
            onClick={onTakeAction}
          >
            Details
          </Button>
        </Box>
      )}
    </Paper>
  );
}

function ActionDrawer({
  target,
  instanceId,
  canAct,
  onClose,
  onComplete,
  onSkip,
  onRefresh,
}: {
  target: ActionTarget | null;
  instanceId?: string;
  canAct: boolean;
  onClose: () => void;
  onComplete: (taskId: string) => Promise<void>;
  onSkip: (taskId: string, reason: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [skipError, setSkipError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openFeedback, setOpenFeedback] = useState(0);

  // Seed the open-feedback count from the polled instance whenever the target changes.
  useEffect(() => {
    setOpenFeedback(target?.task.feedbackCounts?.open ?? 0);
  }, [target]);

  const reset = () => {
    setSkipOpen(false);
    setSkipReason('');
    setSkipError('');
    setLoading(false);
  };

  const isActionable = canAct && target?.task.status === 'active';
  const completeBlocked = openFeedback > 0;

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleComplete = async () => {
    if (!target) return;
    setLoading(true);
    try {
      await onComplete(target.task.id);
      handleClose();
    } finally {
      setLoading(false);
    }
  };

  const handleSkipSubmit = async () => {
    if (!target) return;
    if (!skipReason.trim()) {
      setSkipError('A reason is required to skip a task.');
      return;
    }
    setLoading(true);
    try {
      await onSkip(target.task.id, skipReason.trim());
      handleClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer anchor="right" open={!!target} onClose={handleClose} PaperProps={{ sx: { width: 420 } }}>
      {target && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label="Action required"
                  sx={{ mb: 0.75 }}
                />
                <Typography variant="h6" fontWeight={700} lineHeight={1.25}>
                  {target.task.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {target.blockLabel}
                </Typography>
              </Box>
              <IconButton onClick={handleClose} size="small" sx={{ flexShrink: 0, mt: -0.5 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

          <Box sx={{ flex: 1, p: 2.5, overflow: 'auto' }}>
            {target.task.documentation && (
              <Box
                sx={{
                  mb: 2.5,
                  '& h1, & h2, & h3': { fontSize: '0.9rem', fontWeight: 700, mt: 1.5, mb: 0.5 },
                  '& p': { fontSize: '0.85rem', mt: 0, mb: 1 },
                  '& ul, & ol': { fontSize: '0.85rem', pl: 2.5, mt: 0, mb: 1 },
                  '& code': { fontFamily: 'monospace', fontSize: '0.8em', backgroundColor: 'action.hover', borderRadius: 0.5, px: 0.5 },
                  '& pre': { fontSize: '0.8em', backgroundColor: 'action.hover', borderRadius: 1, p: 1.5, overflow: 'auto' },
                  '& blockquote': { borderLeft: '3px solid', borderColor: 'divider', pl: 1.5, ml: 0, color: 'text.secondary' },
                }}
              >
                <ReactMarkdown>{target.task.documentation}</ReactMarkdown>
              </Box>
            )}
            {instanceId && (
              <>
                <Divider sx={{ mb: 2 }} />
                <FeedbackThread
                  instanceId={instanceId}
                  taskId={target.task.id}
                  canManage={canAct}
                  onOpenCountChange={setOpenFeedback}
                  onChange={onRefresh}
                />
              </>
            )}
            {isActionable && (
              <>
                <Divider sx={{ my: 2.5 }} />
                {!skipOpen ? (
                  <Stack spacing={1.5}>
                    <Tooltip
                      title={
                        completeBlocked
                          ? 'Resolve or grant an exception on all open feedback before completing.'
                          : ''
                      }
                    >
                      <span>
                        <Button
                          variant="contained"
                          color="success"
                          disabled={loading || completeBlocked}
                          onClick={handleComplete}
                          fullWidth
                        >
                          Mark Complete
                        </Button>
                      </span>
                    </Tooltip>
                    <Button
                      variant="outlined"
                      color="warning"
                      disabled={loading}
                      onClick={() => setSkipOpen(true)}
                      fullWidth
                    >
                      Skip Task
                    </Button>
                  </Stack>
                ) : (
                  <>
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
                      helperText={skipError || 'Required — explain why this task is being skipped.'}
                      margin="dense"
                      sx={{ mb: 2 }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button onClick={() => setSkipOpen(false)} disabled={loading}>
                        Back
                      </Button>
                      <Button
                        onClick={handleSkipSubmit}
                        variant="contained"
                        color="warning"
                        disabled={loading || !skipReason.trim()}
                      >
                        Confirm Skip
                      </Button>
                    </Stack>
                  </>
                )}
              </>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  );
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const api = useApi(branchlineApiRef);
  const navigate = useNavigate();

  const { allowed: canAct } = usePermission({
    permission: branchlineWorkflowActPermission,
    resourceRef: workflowId,
  });

  const [workflow, setWorkflow] = useState<WorkflowInstance | null>(null);
  const [relatedWorkflows, setRelatedWorkflows] = useState<WorkflowInstance[]>([]);
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  const [error, setError] = useState('');
  const [expandedBlockId, setExpandedBlockId] = useState<string>('');
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const DESCRIPTION_THRESHOLD = 280;
  const descriptionTruncated = useMemo(() => {
    const desc = workflow?.description ?? '';
    return desc.length > DESCRIPTION_THRESHOLD ? `${desc.slice(0, DESCRIPTION_THRESHOLD).trimEnd()}…` : desc;
  }, [workflow?.description]);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const initializedRef = useRef(false);

  const fetchWorkflow = async () => {
    if (!workflowId) return;
    try {
      const data = await api.getWorkflowInstance(workflowId);
      setWorkflow(prev => {
        if (!initializedRef.current) {
          initializedRef.current = true;
          const blocks = data.parallelBlocks ?? [];
          const firstActive =
            blocks.find(b => derivePhaseStatus(b) === 'active') ?? blocks[0];
          setExpandedBlockId(firstActive?.id ?? '');
        }
        return prev !== null ? { ...data } : data;
      });
      if (data.status !== 'active') {
        clearInterval(pollRef.current);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    fetchWorkflow();
    pollRef.current = setInterval(fetchWorkflow, 10_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(pollRef.current);
      } else {
        setWorkflow(prev => {
          if (prev?.status === 'active') {
            pollRef.current = setInterval(fetchWorkflow, 10_000);
          }
          return prev;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!workflow?.entityRef) return;
    api.listWorkflowInstances({ entityRef: workflow.entityRef })
      .then(all => setRelatedWorkflows(all.filter(w => w.id !== workflowId)))
      .catch(() => { /* silently ignore — this panel is non-critical */ });
  }, [workflow?.entityRef, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceToNextPhaseIfComplete = (taskId: string, patch: Partial<Task>) => {
    setWorkflow(prev => {
      if (!prev) return prev;
      const updatedBlocks = prev.parallelBlocks?.map(block => ({
        ...block,
        steps: block.steps.map(step => ({
          ...step,
          tasks: step.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)),
        })),
      }));
      if (!updatedBlocks) return prev;

      // Find the block that contains this task and check if it's now fully done
      const affectedBlock = updatedBlocks.find(b =>
        b.steps.some(s => s.tasks.some(t => t.id === taskId)),
      );
      if (affectedBlock) {
        const allTasks = affectedBlock.steps.flatMap(s => s.tasks);
        const allDone = allTasks.every(
          t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken',
        );
        if (allDone) {
          const currentIdx = updatedBlocks.findIndex(b => b.id === affectedBlock.id);
          const next = updatedBlocks[currentIdx + 1];
          if (next) {
            setExpandedBlockId(next.id);
          }
        }
      }

      return { ...prev, parallelBlocks: updatedBlocks };
    });
  };

  const handleComplete = async (taskId: string) => {
    if (!workflow) return;
    try {
      await api.completeTask(workflow.id, taskId);
      advanceToNextPhaseIfComplete(taskId, { status: 'completed' });
      fetchWorkflow();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to complete task');
    }
  };

  const handleSkip = async (taskId: string, reason: string) => {
    if (!workflow) return;
    try {
      await api.skipTask(workflow.id, taskId, reason);
      advanceToNextPhaseIfComplete(taskId, { status: 'skipped' });
      fetchWorkflow();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to skip task');
    }
  };

  const handleCancelWorkflow = async () => {
    if (!workflow) return;
    setCancelling(true);
    try {
      await api.cancelWorkflow(workflow.id);
      setCancelDialogOpen(false);
      await fetchWorkflow();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to cancel workflow');
    } finally {
      setCancelling(false);
    }
  };

  if (!workflow && !error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const blocks = workflow?.parallelBlocks ?? [];
  const activeStepIdx = blocks.findIndex(b => {
    const s = derivePhaseStatus(b);
    return s !== 'completed' && s !== 'skipped';
  });
  const activeStep = activeStepIdx === -1 ? blocks.length : activeStepIdx;

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          variant="body2"
          onClick={() => navigate('/branchline')}
          underline="hover"
        >
          Workflows
        </Link>
        <Typography variant="body2">{workflow?.title ?? workflowId}</Typography>
      </Breadcrumbs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {workflow && (
        <>
          {/* Header card */}
          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h5" fontWeight={700}>
                  {workflow.title}
                </Typography>
                {workflow.description && (
                  <Box>
                    <Box
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.875rem',
                        '& p': { m: 0, '&+p': { mt: 1 } },
                        '& ul, & ol': { mt: 0.5, mb: 0.5, pl: 2.5 },
                        '& code': { fontFamily: 'monospace', fontSize: '0.8em' },
                      }}
                    >
                      <ReactMarkdown>
                        {descExpanded || workflow.description.length <= DESCRIPTION_THRESHOLD
                          ? workflow.description
                          : descriptionTruncated}
                      </ReactMarkdown>
                    </Box>
                    {workflow.description.length > DESCRIPTION_THRESHOLD && (
                      <Button
                        size="small"
                        variant="text"
                        endIcon={descExpanded ? <ExpandLessIcon sx={{ fontSize: '14px !important' }} /> : <ExpandMoreIcon sx={{ fontSize: '14px !important' }} />}
                        onClick={() => setDescExpanded(e => !e)}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          fontSize: '0.75rem',
                          textTransform: 'none',
                          verticalAlign: 'baseline',
                          lineHeight: 'inherit',
                          '& .MuiButton-endIcon': { ml: 0.25 },
                        }}
                      >
                        {descExpanded ? 'See less' : 'See more'}
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, ml: 2 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AccountTreeIcon sx={{ fontSize: '14px !important' }} />}
                  onClick={() => setFlowOpen(true)}
                >
                  View Flow
                </Button>
                <StatusBadge status={workflow.status} size="medium" />
              </Stack>
            </Stack>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Typography variant="caption">
                <strong>Owner:</strong> {parseEntityRef(workflow.owningGroup).name}
              </Typography>
              {workflow.entityRef && (
                <Typography variant="caption">
                  <strong>Entity:</strong> {parseEntityRef(workflow.entityRef).name}
                </Typography>
              )}
              <Typography variant="caption">
                <strong>Started:</strong> {new Date(workflow.createdAt).toLocaleDateString()}
              </Typography>
            </Stack>
          </Paper>

          {relatedWorkflows.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={1}>
                Other executions for {parseEntityRef(workflow.entityRef!).name}
              </Typography>
              <Stack spacing={0.75}>
                {(relatedExpanded ? relatedWorkflows : relatedWorkflows.slice(0, 5)).map(w => (
                  <Stack
                    key={w.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
                    onClick={() => navigate(`/branchline/${w.id}`)}
                  >
                    <StatusBadge status={w.status} />
                    <Link
                      component="button"
                      variant="caption"
                      underline="hover"
                      onClick={e => { e.stopPropagation(); navigate(`/branchline/${w.id}`); }}
                      sx={{ textAlign: 'left' }}
                    >
                      {w.title}
                    </Link>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto !important', whiteSpace: 'nowrap' }}>
                      {new Date(w.createdAt).toLocaleDateString()}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
              {relatedWorkflows.length > 5 && (
                <Button
                  size="small"
                  variant="text"
                  sx={{ mt: 0.75, p: 0, fontSize: '0.75rem', textTransform: 'none' }}
                  onClick={() => setRelatedExpanded(e => !e)}
                >
                  {relatedExpanded ? 'Show less' : `Show ${relatedWorkflows.length - 5} more`}
                </Button>
              )}
            </Paper>
          )}

          {blocks.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No tasks found for this workflow. The process may still be initializing.
              </Typography>
            </Box>
          ) : (
            <>
              {/* Phase stepper */}
              <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Stepper activeStep={activeStep} alternativeLabel>
                  {blocks.map(block => {
                    const s = derivePhaseStatus(block);
                    return (
                      <Step key={block.id} completed={s === 'completed'}>
                        <StepLabel>
                          <Typography variant="caption" sx={{ fontSize: 11 }}>
                            {block.label}
                          </Typography>
                        </StepLabel>
                      </Step>
                    );
                  })}
                </Stepper>
              </Paper>

              {/* Phase accordions */}
              {blocks.map((block, blockIdx) => {
                const phaseStatus = derivePhaseStatus(block);
                const prevBlock = blockIdx > 0 ? blocks[blockIdx - 1] : null;
                const isPhaseBlocked =
                  !!prevBlock && derivePhaseStatus(prevBlock) !== 'completed';
                const allTasks = block.steps.flatMap(s => s.tasks);
                const completedCount = allTasks.filter(
                  t =>
                    t.status === 'completed' ||
                    t.status === 'skipped' ||
                    t.status === 'not-taken',
                ).length;

                return (
                  <Accordion
                    key={block.id}
                    expanded={expandedBlockId === block.id}
                    onChange={(_, open) => setExpandedBlockId(open ? block.id : '')}
                    variant="outlined"
                    sx={{ mb: 1, '&:before': { display: 'none' }, opacity: isPhaseBlocked ? 0.7 : 1 }}
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flex: 1, mr: 1 }}>
                        <Box flex={1}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography fontWeight={700}>{block.label}</Typography>
                            <StatusBadge status={phaseStatus} />
                            {isPhaseBlocked && (
                              <Chip
                                size="small"
                                icon={<LockIcon />}
                                label={`Blocked by: ${prevBlock!.label}`}
                                color="warning"
                                variant="outlined"
                              />
                            )}
                          </Stack>
                        </Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          {completedCount}/{allTasks.length} complete
                        </Typography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {block.steps.map((step, stepIdx) => {
                        const blockedByStep = getBlockedByStep(block, stepIdx);
                        if (step.branchType === 'exclusive') {
                          return (
                            <Box key={step.id} sx={{ mb: 1 }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mb: 0.5, fontStyle: 'italic' }}
                              >
                                One of the following paths will be taken:
                              </Typography>
                              {step.tasks.map((task, taskIdx) => (
                                <Box key={task.id}>
                                  {taskIdx > 0 && (
                                    <Box
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        my: 0.5,
                                        gap: 1,
                                      }}
                                    >
                                      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ fontWeight: 700, px: 0.5 }}
                                      >
                                        OR
                                      </Typography>
                                      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                                    </Box>
                                  )}
                                  <TaskRow
                                    task={task}
                                    blockedByLabel={blockedByStep?.label}
                                    onTakeAction={() =>
                                      setActionTarget({ task, blockLabel: block.label })
                                    }
                                  />
                                </Box>
                              ))}
                            </Box>
                          );
                        }
                        return step.tasks.map(task => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            blockedByLabel={blockedByStep?.label}
                            onTakeAction={() =>
                              canAct && setActionTarget({ task, blockLabel: block.label })
                            }
                          />
                        ));
                      })}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </>
          )}
        </>
      )}

      {workflow?.status === 'active' && canAct && (
        <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<CancelIcon />}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancel Workflow
          </Button>
        </Box>
      )}

      <ActionDrawer
        target={actionTarget}
        instanceId={workflow?.id}
        canAct={canAct}
        onClose={() => setActionTarget(null)}
        onComplete={handleComplete}
        onSkip={handleSkip}
        onRefresh={fetchWorkflow}
      />

      <Dialog open={cancelDialogOpen} onClose={() => setCancelDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Cancel this workflow?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will stop all in-progress tasks in <strong>{workflow?.title}</strong> and mark the workflow as cancelled. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelDialogOpen(false)} disabled={cancelling}>
            Keep Working
          </Button>
          <Button
            onClick={handleCancelWorkflow}
            color="error"
            variant="contained"
            disabled={cancelling}
            startIcon={cancelling ? <CircularProgress size={14} /> : <CancelIcon />}
          >
            Cancel Workflow
          </Button>
        </DialogActions>
      </Dialog>

      {workflow && (
        <WorkflowFlowDialog
          open={flowOpen}
          onClose={() => setFlowOpen(false)}
          workflow={workflow}
        />
      )}
    </Box>
  );
}
