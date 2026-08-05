// frontend/src/components/Dashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
    FaEnvelope, FaCheckCircle, FaTimesCircle, FaClock, 
    FaUpload, FaChartLine, FaTable, FaSync,
    FaPaperPlane, FaSearch, FaPlus,
    FaExternalLinkAlt
} from 'react-icons/fa';
import './Dashboard.css';

// const API_URL = 'http://localhost:5000/api';
const API_URL = process.env.REACT_APP_API_URL;const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1KHly4-TWVidpqwn2kzIcIE-PqqHtxBehqt-z1CIRfzY/edit';

const Dashboard = () => {
    const [stats, setStats] = useState({ 
        total: 0, pending: 0, sent: 0, failed: 0, remaining: 0
    });
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    
    const [sheets, setSheets] = useState([]);
    const [selectedSheet, setSelectedSheet] = useState('Sheet1');
    const [sheetData, setSheetData] = useState({ headers: [], data: [] });
    const [isLoadingSheet, setIsLoadingSheet] = useState(false);
    
    const [showAddRow, setShowAddRow] = useState(false);
    const [newRow, setNewRow] = useState({
        email: '',
        firstName: '',
        company: '',
        jobTitle: '',
        status: 'Pending'
    });
    const [addingRow, setAddingRow] = useState(false);
    
    const [showManualSend, setShowManualSend] = useState(false);
    const [manualEmail, setManualEmail] = useState({
        email: '',
        firstName: '',
        company: '',
        jobTitle: ''
    });
    const [sendingSingle, setSendingSingle] = useState(false);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const autoRefreshInterval = useRef(null);

useEffect(() => {
    loadAllData();
    loadSheets();

    autoRefreshInterval.current = setInterval(() => {
        refreshAllData();
    }, 30000);

    return () => {
        if (autoRefreshInterval.current) {
            clearInterval(autoRefreshInterval.current);
        }
    };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

    const loadAllData = async () => {
        try {
            setLoading(true);
            const statsRes = await axios.get(`${API_URL}/stats`);
            if (statsRes.data.success) {
                setStats(statsRes.data.stats);
            }
            setLastRefresh(new Date());
        } catch (error) {
            console.error('Error loading stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadSheets = async () => {
        try {
            const response = await axios.get(`${API_URL}/sheets`);
            console.log('All sheets found:', response.data.sheets);
            const sheetNames = response.data.sheets || ['Sheet1'];
            setSheets(sheetNames);
            
            if (sheetNames.length > 0) {
                const firstSheet = sheetNames[0];
                setSelectedSheet(firstSheet);
                loadSheetData(firstSheet);
            }
        } catch (error) {
            console.error('Error loading sheets:', error);
        }
    };

    const loadSheetData = async (sheetName) => {
        try {
            setIsLoadingSheet(true);
            console.log('Loading sheet:', sheetName);
            const response = await axios.get(`${API_URL}/sheet-data/${sheetName}`);
            setSheetData(response.data);
            setSelectedSheet(sheetName);
            setLastRefresh(new Date());
        } catch (error) {
            console.error('Error loading sheet data:', error);
        } finally {
            setIsLoadingSheet(false);
        }
    };

    const handleSheetChange = (e) => {
        const sheetName = e.target.value;
        console.log('Selected sheet:', sheetName);
        setSelectedSheet(sheetName);
        loadSheetData(sheetName);
    };

    const openGoogleSheets = () => {
        window.open(SPREADSHEET_URL, '_blank');
    };

    const refreshAllData = async () => {
        try {
            setLoading(true);
            const statsRes = await axios.get(`${API_URL}/stats`);
            if (statsRes.data.success) {
                setStats(statsRes.data.stats);
            }
            if (selectedSheet) {
                const sheetRes = await axios.get(`${API_URL}/sheet-data/${selectedSheet}`);
                setSheetData(sheetRes.data);
            }
            setLastRefresh(new Date());
        } catch (error) {
            console.error('Error refreshing data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddRow = async (e) => {
        e.preventDefault();
        if (!newRow.email) {
            alert('Email is required!');
            return;
        }

        setAddingRow(true);
        try {
            console.log('Adding row to sheet:', selectedSheet);
            console.log('Row data:', newRow);
            
            const response = await axios.post(`${API_URL}/add-row`, {
                ...newRow,
                sheetName: selectedSheet
            });
            
            console.log('Add row response:', response.data);
            
            if (response.data.success) {
                alert(`✅ Row added successfully to "${selectedSheet}"!`);
                setNewRow({ email: '', firstName: '', company: '', jobTitle: '', status: 'Pending' });
                setShowAddRow(false);
                await refreshAllData();
            } else {
                alert(`❌ ${response.data.message}`);
            }
        } catch (error) {
            console.error('Error adding row:', error);
            const errorMsg = error.response?.data?.message || error.message;
            alert(`❌ Error: ${errorMsg}`);
        } finally {
            setAddingRow(false);
        }
    };

    const handleSendAll = async () => {
        const pendingCount = sheetData.data.filter(r => 
            r.status && r.status.toLowerCase() === 'pending'
        ).length;
        
        if (pendingCount === 0) {
            alert('No pending applications found in this sheet!');
            return;
        }

        if (!window.confirm(`Send ${pendingCount} emails from "${selectedSheet}"?`)) return;

        setSending(true);
        setResults([]);

        try {
            const response = await axios.post(`${API_URL}/send-all`);
            if (response.data.success) {
                setResults(response.data.results || []);
                alert(`✅ Sent: ${response.data.sent}\n❌ Failed: ${response.data.failed}\n📊 Remaining today: ${response.data.remaining || 'N/A'}`);
                await refreshAllData();
            } else {
                alert(`❌ ${response.data.message}`);
            }
        } catch (error) {
            console.error('Error sending emails:', error);
            alert('Error sending emails: ' + (error.response?.data?.message || error.message));
        } finally {
            setSending(false);
        }
    };

    const handleSendSingle = async (e) => {
        e.preventDefault();
        if (!manualEmail.email) {
            alert('Please enter an email address');
            return;
        }

        setSendingSingle(true);
        try {
            const response = await axios.post(`${API_URL}/send-single`, {
                ...manualEmail,
                sheetName: selectedSheet
            });
            
            if (response.data.success) {
                alert(`✅ Email sent to ${manualEmail.email}\n📊 Remaining today: ${response.data.remaining || 'N/A'}`);
                setManualEmail({ email: '', firstName: '', company: '', jobTitle: '' });
                setShowManualSend(false);
                await refreshAllData();
            } else {
                alert(`❌ ${response.data.message}`);
            }
        } catch (error) {
            console.error('Error sending email:', error);
            alert(`❌ Error: ${error.response?.data?.message || error.message}`);
        } finally {
            setSendingSingle(false);
        }
    };

    const handleStatusUpdate = async (email, newStatus) => {
        try {
            const response = await axios.post(`${API_URL}/update-status`, {
                email: email,
                status: newStatus,
                notes: `Status changed to ${newStatus} manually`,
                sheetName: selectedSheet
            });
            
            if (response.data.success) {
                const data = response.data.data || {};
                let message = `✅ Status updated to ${newStatus}`;
                if (data.dateSent && data.dateSent !== '') {
                    message += ` at ${data.dateSent}`;
                }
                alert(message);
                await refreshAllData();
            } else {
                alert(`❌ ${response.data.message}`);
            }
        } catch (error) {
            console.error('Error updating status:', error);
            alert(`❌ Error updating status: ${error.response?.data?.message || error.message}`);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('resume', file);

        try {
            setUploading(true);
            await axios.post(`${API_URL}/upload-resume`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            alert('✅ Resume uploaded successfully!');
        } catch (error) {
            alert('❌ Error uploading resume');
            console.error(error);
        } finally {
            setUploading(false);
        }
    };

    const getFilteredData = () => {
        let filtered = sheetData.data;
        
        if (searchTerm) {
            filtered = filtered.filter(row => 
                row.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.jobtitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                row.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        
        if (statusFilter !== 'all') {
            filtered = filtered.filter(row => 
                row.status?.toLowerCase() === statusFilter.toLowerCase()
            );
        }
        
        return filtered;
    };

    const filteredData = getFilteredData();
    const pendingCount = sheetData.data.filter(r => 
        r.status && r.status.toLowerCase() === 'pending'
    ).length;

    return (
        <div className="dashboard">
            <header className="header">
                <h1>🚀 Job Application Automation</h1>
                <p>Send personalized emails to potential employers</p>
                <div className="refresh-info">
                    <span className="last-refresh">
                        Last updated: {lastRefresh.toLocaleTimeString()}
                        <button 
                            className="refresh-btn-mini"
                            onClick={refreshAllData}
                            disabled={loading}
                        >
                            <FaSync className={loading ? 'spinning' : ''} /> Refresh
                        </button>
                    </span>
                </div>
            </header>

            <div className="sheet-selector">
                <div className="sheet-selector-content">
                    <FaTable className="sheet-icon" />
                    <label>Select Sheet:</label>
                    <select 
                        value={selectedSheet} 
                        onChange={handleSheetChange}
                        disabled={isLoadingSheet}
                        className="sheet-select"
                    >
                        {sheets.map((sheet, index) => (
                            <option key={index} value={sheet}>
                                {sheet}
                            </option>
                        ))}
                    </select>
                    <button 
                        className="refresh-btn"
                        onClick={() => loadSheetData(selectedSheet)}
                        disabled={isLoadingSheet}
                    >
                        <FaSync className={isLoadingSheet ? 'spinning' : ''} />
                    </button>
                    <button 
                        className="open-sheets-btn"
                        onClick={openGoogleSheets}
                        title="Open Google Sheets"
                    >
                        <FaExternalLinkAlt /> Open Sheets
                    </button>
                    <span className="sheet-status">
                        {isLoadingSheet ? 'Loading...' : `${sheetData.data.length} records in "${selectedSheet}"`}
                    </span>
                </div>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <FaEnvelope className="stat-icon blue" />
                    <div className="stat-info">
                        <span className="stat-value">{sheetData.data.length}</span>
                        <span className="stat-label">Total Records</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaClock className="stat-icon yellow" />
                    <div className="stat-info">
                        <span className="stat-value">{pendingCount}</span>
                        <span className="stat-label">Pending</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaCheckCircle className="stat-icon green" />
                    <div className="stat-info">
                        <span className="stat-value">
                            {sheetData.data.filter(r => r.status?.toLowerCase() === 'sent').length}
                        </span>
                        <span className="stat-label">Sent</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaTimesCircle className="stat-icon red" />
                    <div className="stat-info">
                        <span className="stat-value">
                            {sheetData.data.filter(r => r.status?.toLowerCase() === 'failed').length}
                        </span>
                        <span className="stat-label">Failed</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FaChartLine className="stat-icon purple" />
                    <div className="stat-info">
                        <span className="stat-value">{stats.remaining || 0}</span>
                        <span className="stat-label">Remaining Today</span>
                    </div>
                </div>
            </div>

            <div className="actions">
                <div className="actions-left">
                    <div className="resume-upload">
                        <label className="upload-btn">
                            <FaUpload /> Upload Resume
                            <input type="file" accept=".pdf" onChange={handleUpload} disabled={uploading} />
                        </label>
                        {uploading && <span className="uploading-text">Uploading...</span>}
                    </div>
                    <button 
                        className="add-row-btn"
                        onClick={() => setShowAddRow(!showAddRow)}
                    >
                        <FaPlus /> Add Row
                    </button>
                    <button 
                        className="manual-send-btn"
                        onClick={() => setShowManualSend(!showManualSend)}
                    >
                        <FaPaperPlane /> Manual Send
                    </button>
                </div>
                <button
                    className="send-btn"
                    onClick={handleSendAll}
                    disabled={sending || pendingCount === 0}
                >
                    {sending ? '⏳ Sending...' : `📧 Send ${pendingCount} Emails`}
                </button>
            </div>

            {showAddRow && (
                <div className="add-row-form">
                    <h3>➕ Add New Application</h3>
                    <p className="form-info">Add a new row to sheet: <strong>{selectedSheet}</strong></p>
                    <form onSubmit={handleAddRow}>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Email *</label>
                                <input
                                    type="email"
                                    value={newRow.email}
                                    onChange={(e) => setNewRow({...newRow, email: e.target.value})}
                                    placeholder="hr@company.com"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>First Name</label>
                                <input
                                    type="text"
                                    value={newRow.firstName}
                                    onChange={(e) => setNewRow({...newRow, firstName: e.target.value})}
                                    placeholder="Hiring Manager"
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Company</label>
                                <input
                                    type="text"
                                    value={newRow.company}
                                    onChange={(e) => setNewRow({...newRow, company: e.target.value})}
                                    placeholder="Company Name"
                                />
                            </div>
                            <div className="form-group">
                                <label>Job Title</label>
                                <input
                                    type="text"
                                    value={newRow.jobTitle}
                                    onChange={(e) => setNewRow({...newRow, jobTitle: e.target.value})}
                                    placeholder="Flutter Developer"
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Status</label>
                                <select
                                    value={newRow.status}
                                    onChange={(e) => setNewRow({...newRow, status: e.target.value})}
                                >
                                    <option value="Pending">Pending</option>
                                    <option value="Sent">Sent</option>
                                    <option value="Failed">Failed</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" disabled={addingRow} className="add-submit-btn">
                                <FaPlus /> {addingRow ? 'Adding...' : 'Add Row'}
                            </button>
                            <button type="button" onClick={() => setShowAddRow(false)} className="cancel-btn">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {showManualSend && (
                <div className="manual-send-form">
                    <h3>📧 Manual Email Send</h3>
                    <p className="remaining-info">Remaining today: {stats.remaining || 0} emails</p>
                    <p className="sheet-info">Sending to sheet: <strong>{selectedSheet}</strong></p>
                    <form onSubmit={handleSendSingle}>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Email *</label>
                                <input
                                    type="email"
                                    value={manualEmail.email}
                                    onChange={(e) => setManualEmail({...manualEmail, email: e.target.value})}
                                    placeholder="hr@company.com"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>First Name</label>
                                <input
                                    type="text"
                                    value={manualEmail.firstName}
                                    onChange={(e) => setManualEmail({...manualEmail, firstName: e.target.value})}
                                    placeholder="Hiring Manager"
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Company</label>
                                <input
                                    type="text"
                                    value={manualEmail.company}
                                    onChange={(e) => setManualEmail({...manualEmail, company: e.target.value})}
                                    placeholder="Company Name"
                                />
                            </div>
                            <div className="form-group">
                                <label>Job Title</label>
                                <input
                                    type="text"
                                    value={manualEmail.jobTitle}
                                    onChange={(e) => setManualEmail({...manualEmail, jobTitle: e.target.value})}
                                    placeholder="Flutter Developer"
                                />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" disabled={sendingSingle} className="send-single-btn">
                                <FaPaperPlane /> {sendingSingle ? 'Sending...' : 'Send Email'}
                            </button>
                            <button type="button" onClick={() => setShowManualSend(false)} className="cancel-btn">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {results.length > 0 && (
                <div className="results">
                    <h3>📊 Results</h3>
                    <div className="results-grid">
                        {results.map((result, index) => (
                            <div key={index} className={`result-item ${result.status}`}>
                                <span>{result.email}</span>
                                <span className="result-status">
                                    {result.status === 'success' ? '✅' : '❌'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="search-filter">
                <div className="search-box">
                    <FaSearch className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search by email, company, or job title..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <select 
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="sent">Sent</option>
                    <option value="failed">Failed</option>
                </select>
            </div>

            <div className="applications">
                <h3>📋 Sheet Data - {selectedSheet}</h3>
                {isLoadingSheet ? (
                    <p>Loading...</p>
                ) : sheetData.data.length === 0 ? (
                    <p className="no-applications">✨ No data found in "{selectedSheet}"</p>
                ) : filteredData.length === 0 ? (
                    <p className="no-applications">🔍 No matching records found in "{selectedSheet}"</p>
                ) : (
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>Email</th>
                                    <th>Name</th>
                                    <th>Company</th>
                                    <th>Job Title</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.map((row, index) => {
                                    const status = row.status || 'Pending';
                                    const firstName = row.firstname || row.firstName || '';
                                    const company = row.company || '';
                                    const jobTitle = row.jobtitle || row.jobTitle || '';
                                    
                                    return (
                                        <tr key={index}>
                                            <td>{row.email}</td>
                                            <td>{firstName}</td>
                                            <td>{company}</td>
                                            <td>{jobTitle}</td>
                                            <td>
                                                <span className={`status-badge ${status.toLowerCase()}`}>
                                                    {status}
                                                </span>
                                            </td>
                                            <td className="actions-cell">
                                                {status.toLowerCase() === 'pending' && (
                                                    <button 
                                                        className="action-btn send"
                                                        onClick={() => {
                                                            setManualEmail({
                                                                email: row.email,
                                                                firstName: firstName,
                                                                company: company,
                                                                jobTitle: jobTitle
                                                            });
                                                            setShowManualSend(true);
                                                        }}
                                                        title="Send email"
                                                    >
                                                        <FaPaperPlane />
                                                    </button>
                                                )}
                                                <select 
                                                    className="status-select"
                                                    value={status.toLowerCase()}
                                                    onChange={(e) => handleStatusUpdate(row.email, e.target.value)}
                                                >
                                                    <option value="pending">Set Pending</option>
                                                    <option value="sent">Set Sent</option>
                                                    <option value="failed">Set Failed</option>
                                                </select>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;