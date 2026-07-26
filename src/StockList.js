import React from 'react';
import Box from '@mui/material/Box';
import { DataGrid } from '@mui/x-data-grid';
import Avatar from '@mui/material/Avatar';

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const columns = [
    {
      field: 'symbol',
      headerName: 'Symbol',
    },
    {
      field: 'marketCap',
      headerName: 'Market cap',
      type: 'number',
    },
    {
      field: 'logo',
      headerName: 'Logo',
      sortable: false,
      renderCell: (params) => (
        <Avatar alt="logo">{params.row.symbol?.slice(0, 1)}</Avatar>
      )
    },
    {
      field: 'name',
      headerName: 'Name',
      width: 200,
    },
    {
      field: 'price',
      headerName: 'Price',
      type: 'number',
      valueFormatter: (value) => usdFormatter.format(value),
    },
    { field: 'changePercentage',
      headerName: 'Percent Change',
      type: 'number',
      valueFormatter: (value) => `${Number(value).toFixed(2)}%`,
      renderCell: (params) => {
        const raw = Number(params.value);
        const formatted = `${raw.toFixed(2)}%`;
        return <Box sx={{ color: raw > 0 ? 'green' : 'red'}}>{formatted}</Box>
      }
    },
    { field: 'pe',
      headerName: 'PE Ratio',
      type: 'number',
    },
    { field: 'sector', headerName: 'Sector', width: 160 }
  ];

function StockList() {
    const [rows, setRows] = React.useState([]);
    const [error, setError] = React.useState('');
    
    React.useEffect(() => {
        const controller = new AbortController();
        fetch('/api/stocks?universe=sp500', { signal: controller.signal })
          .then(async (response) => {
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || payload.error);
            return payload;
          })
          .then((payload) => setRows(payload.stocks))
          .catch((requestError) => {
            if (requestError.name !== 'AbortError') setError(requestError.message);
          });
        return () => controller.abort();
    }, []);

    if (error) return <Box role="alert">{error}</Box>;

    return rows.length ? (
        <Box sx={{ width: '100%' }}>
            <DataGrid
                rows={rows}
                columns={columns}
                getRowId={(row) => row.symbol}
            />
        </Box>
        ) : (
            <Box>Loading...</Box>
        );
}

export default StockList;
