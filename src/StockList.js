import React from 'react';
import Box from '@mui/material/Box';
import { DataGrid } from '@mui/x-data-grid';
// import sp500 from './sp500.csv';
import stocks500 from './sp500.json';
import Avatar from '@mui/material/Avatar';
const ZACKS_BASE_URL = 'https://quote-feed.zacks.com/';


const stocks = [
    'MSFT', 'AAPL', 'NVDA', 'AMZN', 'GOOGL', 'META', 'GOOG', 'BRK.B', 'LLY', 'JPM', 
    // 'AVGO', 'TSLA', 'XOM', 'UNH', 'V', 'PG', 'MA', 'JNJ', 'HD', 'COST',
    // 'MRK', 'ABBV', 'CVX',
    'ADSK'
];

const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const columns = [
    {
      field: 'id',
      headerName: 'Symbol',
    },
    {
      field: 'company_logo_url',
      headerName: 'Logo',
      renderCell: (params) => (
        // <Box sx={{height: '100%', p: 1}}><Avatar alt="logo" src={params.value} /></Box>
        <Avatar alt="logo" src={params.value} />
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
    { field: 'percent_net_change',
      headerName: 'Percent Change',
      type: 'number',
      valueFormatter: (value) => `${Number(value).toFixed(2)}%`,
      renderCell: (params) => {
        const raw = Number(params.value);
        const formatted = `${raw.toFixed(2)}%`;
        return <Box sx={{ color: raw > 0 ? 'green' : 'red'}}>{formatted}</Box>
      }
    },
    { field: 'pe_f1',
      headerName: 'PE Ratio',
      type: 'number',
    },
    {
      field: 'zacks_rank',
      headerName: 'Zacks Number',
      type: 'number',
    },
    {
      field: 'zacks_rank_text',
      headerName: 'Zacks Rank',
    }
  ];

function fetchHttp(url) {
    return new Promise(function (resolve, reject) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = function() {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject({
                status: this.status,
                statusText: xhr.statusText
            });
          }
        };
        xhr.onerror = function () {
            reject({
                status: this.status,
                statusText: xhr.statusText
            });
        };
        xhr.send();
    });
}

function getZacksInfo(ticker) {
    const url = `${ZACKS_BASE_URL}index.json?t=${ticker}`;
    return fetchHttp(url);
}

function calculateDayDifference(date1, date2) {
    // Convert both dates to milliseconds
    var date1_ms = date1.getTime();
    var date2_ms = date2.getTime();
  
    // Calculate the difference in milliseconds
    var difference_ms = Math.abs(date1_ms - date2_ms);
      
    // Convert back to days and return
    return Math.round(difference_ms / (1000 * 60 * 60 * 24));
}

function StockList() {
    // getZacksInfo('ADSK');
    const [rows, setRows] = React.useState([]);
    const [lastUpdated, setLastUpdated] = React.useState(localStorage.getItem('lastUpdated') || '');
    const [lastData, setLastData] = React.useState(localStorage.getItem('lastData') || '');
    
    React.useEffect(() => {
        const fetchAllData = async (stockList) => {
            const result = [];
            for (const s of stockList) {
                const res = await getZacksInfo(s);
                const data = res[s];
                if (data) {
                    if (data.error) {
                        console.log(`error ${s}`, data);
                        continue;
                    }
                    if (data.zacks_rank) {
                        result.push({
                            id: s,
                            name: data.ap_short_name,
                            price: data.last,
                            ...data,
                        });
                    }
                }
            }
            // console.log('result', result);
            setRows(result);
            const newTimestamp = new Date().toString();
            setLastUpdated(newTimestamp);
            localStorage.setItem('lastUpdated', newTimestamp);
            setLastData(JSON.stringify(result));
            localStorage.setItem('lastData', JSON.stringify(result));
        }
        // console.log('stocks', stocks500);
        // console.log('lastUpdate', lastUpdated, lastData, calculateDayDifference(new Date(lastUpdated), new Date()));

        if (lastUpdated && lastData && calculateDayDifference(new Date(lastUpdated), new Date()) <= 0) {
            console.log('read data from local storage', JSON.parse(lastData));
            setRows(JSON.parse(lastData));
        } else {
            console.log('fetch new data');
            fetchAllData(stocks500.length ? stocks500 : stocks);
        }
    }, [lastUpdated, lastData]);

    return rows.length ? (
        <Box sx={{ width: '100%' }}>
            <DataGrid
                rows={rows}
                columns={columns}
            />
        </Box>
        ) : (
            <Box>Loading...</Box>
        );
}

export default StockList;