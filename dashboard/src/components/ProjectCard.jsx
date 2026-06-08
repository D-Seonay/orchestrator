import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ProjectCard = ({ project, onUpdate, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    script: project.script || '',
    args: (project.args || []).join(' '),
    cwd: project.cwd || ''
  });

  const isOnline = project.status?.toLowerCase() === 'online';

  const handleSave = () => {
    onUpdate({
      ...editData,
      args: editData.args.split(' ').filter(arg => arg !== '')
    });
    setIsEditing(false);
  };

  return (
    <motion.div 
      className="project-card"
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ 
        duration: 0.8, 
        ease: [0.16, 1, 0.3, 1] 
      }}
    >
      <div className="project-header">
        <h2 className="project-name">{project.name}</h2>
        <div className="header-actions">
          <motion.span 
            className={`project-status ${isOnline ? 'status-online' : 'status-offline'}`}
            initial={false}
            animate={{ 
              opacity: [0.5, 1, 0.5],
              transition: isOnline ? { repeat: Infinity, duration: 3 } : {}
            }}
          >
            {project.status}
          </motion.span>
          <button className="delete-btn" onClick={onDelete}>&times;</button>
        </div>
      </div>
      
      <div className="project-details">
        {isEditing ? (
          <div className="edit-fields">
            <div className="edit-group">
              <label>SCRIPT</label>
              <input 
                value={editData.script}
                onChange={(e) => setEditData({ ...editData, script: e.target.value })}
              />
            </div>
            <div className="edit-group">
              <label>ARGS</label>
              <input 
                value={editData.args}
                onChange={(e) => setEditData({ ...editData, args: e.target.value })}
              />
            </div>
            <div className="edit-group">
              <label>CWD</label>
              <input 
                value={editData.cwd}
                onChange={(e) => setEditData({ ...editData, cwd: e.target.value })}
              />
            </div>
            <div className="edit-actions">
              <button onClick={handleSave}>SAVE</button>
              <button onClick={() => setIsEditing(false)}>CANCEL</button>
            </div>
          </div>
        ) : (
          <div className="display-fields" onClick={() => setIsEditing(true)}>
            <div className="detail-item">
              <span className="detail-label">LAUNCH_SCRIPT</span>
              <span className="detail-value">{project.script || 'N/A'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">WORKING_DIR</span>
              <span className="detail-value">{project.cwd || './'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="project-stats">
        <div className="stat-item">
          <span className="stat-label">System CPU</span>
          <span className="stat-value">{project.cpu || '0%'}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Allocated RAM</span>
          <span className="stat-value">{project.ram || '0MB'}</span>
        </div>
      </div>

      <div className="project-footer">
        <div className="uptime-pill">
          UPTIME // {project.uptime || '0s'}
        </div>
        <div className="branch-info">
          {project.branch || 'main'}
        </div>
      </div>
    </motion.div>
  );
};

export default ProjectCard;
