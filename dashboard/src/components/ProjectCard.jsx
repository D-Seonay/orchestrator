import React from 'react';
import { motion } from 'framer-motion';

const ProjectCard = ({ project }) => {
  const isOnline = project.status === 'online';

  return (
    <motion.div 
      className="project-card"
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
      </div>
      
      <div className="project-stats">
        <div className="stat-item">
          <span className="stat-label">System CPU</span>
          <span className="stat-value">{project.cpu}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Allocated RAM</span>
          <span className="stat-value">{project.ram}</span>
        </div>
      </div>

      <div className="project-footer">
        <div className="uptime-pill">
          UPTIME // {project.uptime}
        </div>
        <div className="branch-info">
          {project.branch}
        </div>
      </div>
    </motion.div>
  );
};

export default ProjectCard;
