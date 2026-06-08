import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ProjectCard from './components/ProjectCard';
import AddProjectModal from './components/AddProjectModal';
import './App.css';

const API_PORT = 4444;
const API_BASE_URL = `http://${window.location.hostname}:${API_PORT}/api`;
const API_URL = `${API_BASE_URL}/apps`;

function App() {
  const [projects, setProjects] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = async () => {
    try {
      const [statusRes, appsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/status`),
        fetch(`${API_BASE_URL}/apps`)
      ]);
      
      const statusData = await statusRes.json();
      const appsData = await appsRes.json();

      const merged = appsData.map(app => {
        const status = statusData.apps.find(s => s.name === app.name) || {};
        return {
          ...app,
          ...status,
          // Ensure branch info is flat for the ProjectCard
          branch: status.git?.branch || 'main'
        };
      });

      setProjects(merged);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddProject = async (projectData) => {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Deployment failed');
      }

      await fetchProjects();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to add project:', error);
      throw error;
    }
  };

  const handleUpdateProject = async (name, updateData) => {
    try {
      const response = await fetch(`${API_URL}/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (response.ok) {
        fetchProjects();
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleDeleteProject = async (name) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    try {
      const response = await fetch(`${API_URL}/${name}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        fetchProjects();
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  return (
    <div className="dashboard">
      <header>
        <div className="header-top">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            ORCHESTRATOR<br />
            PRO_DASHBOARD
          </motion.h1>
          <motion.button 
            className="deploy-button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsModalOpen(true)}
          >
            + DEPLOY
          </motion.button>
        </div>
      </header>

      <main>
        <div className="projects-grid">
          <AnimatePresence mode="popLayout">
            {projects.map((project) => (
              <ProjectCard 
                key={project.name} 
                project={project} 
                onUpdate={(data) => handleUpdateProject(project.name, data)}
                onDelete={() => handleDeleteProject(project.name)}
              />
            ))}
          </AnimatePresence>
          {!isLoading && projects.length === 0 && (
            <p className="no-projects">NO PROJECTS FOUND. CLICK + DEPLOY TO START.</p>
          )}
        </div>
      </main>

      <AddProjectModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAddProject}
      />
    </div>
  );
}

export default App;
