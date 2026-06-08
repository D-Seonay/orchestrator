import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

const mockProjects = [
  {
    name: 'ORCHESTRATOR',
    status: 'online',
    cpu: '1.2%',
    ram: '45MB',
    uptime: '12h 30m 15s',
    branch: 'main'
  },
  {
    name: 'FRONT-SEMAPHORE',
    status: 'online',
    cpu: '0.5%',
    ram: '128MB',
    uptime: '45m 10s',
    branch: 'develop'
  },
  {
    name: 'AUTH-SERVICE',
    status: 'offline',
    cpu: '0%',
    ram: '0MB',
    uptime: '0s',
    branch: 'main'
  },
  {
    name: 'LOGGER-DB',
    status: 'online',
    cpu: '2.4%',
    ram: '256MB',
    uptime: '3d 4h 12m',
    branch: 'main'
  }
];

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

function App() {
  return (
    <div className="dashboard">
      <header>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          ORCHESTRATOR<br />
          PRO_DASHBOARD
        </motion.h1>
      </header>

      <main>
        <div className="projects-grid">
          <AnimatePresence mode="popLayout">
            {mockProjects.map((project, index) => (
              <ProjectCard 
                key={project.name} 
                project={project} 
              />
            ))}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default App;
