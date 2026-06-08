import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ProjectCard from './components/ProjectCard';
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
