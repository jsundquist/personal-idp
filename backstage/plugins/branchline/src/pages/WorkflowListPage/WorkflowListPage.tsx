import { parseEntityRef } from '@backstage/catalog-model';
import { useApi } from '@backstage/frontend-plugin-api';
import AddIcon from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { StartWorkflowDialog } from '../../components/StartWorkflowDialog';
import { StatusBadge } from '../../components/StatusBadge';
import type { WorkflowDefinition, WorkflowInstance, WorkflowStatus } from '../../types';

type SortField = 'title' | 'status' | 'definitionId' | 'owningGroup' | 'entityRef' | 'createdAt';
type SortDir = 'asc' | 'desc';

const ALL = '__all__';

export function WorkflowListPage() {
  const api = useApi(branchlineApiRef);
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowInstance[]>([]);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const [filterStatus, setFilterStatus] = useState<string>(ALL);
  const [filterDefinition, setFilterDefinition] = useState<string>(ALL);
  const [filterOwner, setFilterOwner] = useState<string>(ALL);
  const [filterEntity, setFilterEntity] = useState<string>(ALL);

  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [activeTab, setActiveTab] = useState<'all' | 'mine'>('all');

  useEffect(() => {
    setLoading(true);
    setError('');
    const workflowsPromise = activeTab === 'mine'
      ? api.listMyWorkflowInstances()
      : api.listWorkflowInstances();
    Promise.all([workflowsPromise, api.getWorkflowDefinitions()])
      .then(([wfs, defs]) => {
        setWorkflows(wfs);
        setDefinitions(defs);
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreated = (instanceId: string) => {
    setDialogOpen(false);
    navigate(`/branchline/${instanceId}`);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const definitionMap = useMemo(
    () => Object.fromEntries(definitions.map(d => [d.id, d.name])),
    [definitions],
  );

  const owners = useMemo(
    () => [...new Set(workflows.map(w => w.owningGroup))].sort(),
    [workflows],
  );
  const entities = useMemo(
    () => [...new Set(workflows.map(w => w.entityRef).filter(Boolean) as string[])].sort(),
    [workflows],
  );

  const filtered = useMemo(() => {
    let rows = workflows;
    if (filterStatus !== ALL) rows = rows.filter(w => w.status === filterStatus);
    if (filterDefinition !== ALL) rows = rows.filter(w => w.definitionId === filterDefinition);
    if (filterOwner !== ALL) rows = rows.filter(w => w.owningGroup === filterOwner);
    if (filterEntity !== ALL) rows = rows.filter(w => w.entityRef === filterEntity);

    return [...rows].sort((a, b) => {
      const aVal = String(a[sortField] ?? '');
      const bVal = String(b[sortField] ?? '');
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [workflows, filterStatus, filterDefinition, filterOwner, filterEntity, sortField, sortDir]);

  const resetPage = () => setPage(0);

  const col = (field: SortField, label: string) => (
    <TableCell sortDirection={sortField === field ? sortDir : false}>
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDir : 'asc'}
        onClick={() => handleSort(field)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const progressColor = (status: WorkflowStatus) => {
    if (status === 'completed') return 'success' as const;
    if (status === 'cancelled' || status === 'failed') return 'error' as const;
    return 'primary' as const;
  };

  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={{ p: 2 }}>
      <Toolbar variant="dense" disableGutters sx={{ mb: 1, gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
          Workflow Instances
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} size="small" onClick={() => setDialogOpen(true)}>
          Start Workflow
        </Button>
      </Toolbar>

      <Tabs
        value={activeTab}
        onChange={(_, v) => { setActiveTab(v); setPage(0); }}
        sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="All Workflows" value="all" />
        <Tab label="My Workflows" value="mine" />
      </Tabs>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Owner</InputLabel>
              <Select
                value={filterOwner}
                label="Owner"
                onChange={e => { setFilterOwner(e.target.value); resetPage(); }}
              >
                <MenuItem value={ALL}><em>All</em></MenuItem>
                {owners.map(o => (
                  <MenuItem key={o} value={o}>{o.split('/').pop()}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {entities.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Entity</InputLabel>
                <Select
                  value={filterEntity}
                  label="Entity"
                  onChange={e => { setFilterEntity(e.target.value); resetPage(); }}
                >
                  <MenuItem value={ALL}><em>All</em></MenuItem>
                  {entities.map(e => (
                    <MenuItem key={e} value={e}>{e.split('/').pop()}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Workflow Template</InputLabel>
              <Select
                value={filterDefinition}
                label="Workflow Template"
                onChange={e => { setFilterDefinition(e.target.value); resetPage(); }}
              >
                <MenuItem value={ALL}><em>All</em></MenuItem>
                {definitions.map(d => (
                  <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={filterStatus}
                label="Status"
                onChange={e => { setFilterStatus(e.target.value); resetPage(); }}
              >
                <MenuItem value={ALL}><em>All</em></MenuItem>
                {(['active', 'completed', 'cancelled', 'failed'] as WorkflowStatus[]).map(s => (
                  <MenuItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {col('title', 'Title')}
                  {col('owningGroup', 'Owner')}
                  {col('entityRef', 'Entity')}
                  {col('definitionId', 'Workflow Template')}
                  {col('createdAt', 'Created')}
                  <TableCell>Progress</TableCell>
                  {col('status', 'Status')}
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map(wf => {
                  const completed = wf.completedPhases ?? 0;
                  const total = wf.totalPhases ?? 0;
                  let pct: number;
                  if (total > 0) pct = (completed / total) * 100;
                  else if (wf.status === 'completed') pct = 100;
                  else pct = 0;
                  return (
                    <TableRow
                      key={wf.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/branchline/${wf.id}`)}
                    >
                      <TableCell>
                        <Link
                          component="button"
                          variant="body2"
                          onClick={e => { e.stopPropagation(); navigate(`/branchline/${wf.id}`); }}
                          underline="hover"
                          sx={{ textAlign: 'left', fontWeight: 500 }}
                        >
                          {wf.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontSize={12}>
                          {parseEntityRef(wf.owningGroup).name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontSize={12} color="text.secondary">
                          {wf.entityRef ? parseEntityRef(wf.entityRef).name : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontSize={12}>
                          {definitionMap[wf.definitionId] ?? wf.definitionId}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontSize={12}>
                          {new Date(wf.createdAt).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ minWidth: 100 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LinearProgress
                            variant="determinate"
                            value={pct}
                            color={progressColor(wf.status)}
                            sx={{ flex: 1, height: 4, borderRadius: 2 }}
                          />
                          <Typography variant="caption" fontSize={10}>
                            {total > 0 ? `${completed}/${total}` : `${Math.round(pct)}%`}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={wf.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="text.secondary" py={3} fontSize={12}>
                        {workflows.length === 0
                          ? 'No workflows yet. Start one using the button above.'
                          : 'No workflows match the current filters.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={e => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25, 50, 100]}
            />
          </TableContainer>
        </>
      )}

      <StartWorkflowDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </Box>
  );
}
