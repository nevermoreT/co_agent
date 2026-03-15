/**
 * Integration tests for A2A Task Routes
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';

// Instead of importing the full app, we'll create a lightweight test version
import a2aRoutes from '../../server/routes/a2a.js';
import a2aTaskRoutes from '../../server/routes/a2a-tasks.js';

describe('A2A Task Routes - Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    // Add the A2A routes
    app.use('/a2a', a2aTaskRoutes);
    app.use('/', a2aRoutes); // For agent card endpoint
  });

  it('should serve agent card at /.well-known/agent.json', async () => {
    const response = await request(app)
      .get('/.well-known/agent.json')
      .expect(200);
    
    expect(response.body).toHaveProperty('name');
    expect(response.body).toHaveProperty('description');
    expect(response.body).toHaveProperty('capabilities');
    expect(response.body.name).toBe('Co-Agent Platform');
    expect(Array.isArray(response.body.skills)).toBe(true);
  });

  it('should get all agents', async () => {
    // a2a.js (agents list) is mounted at /, so path is /agents not /a2a/agents
    const response = await request(app)
      .get('/agents')
      .expect(200);

    expect(response.body).toHaveProperty('agents');
    expect(Array.isArray(response.body.agents)).toBe(true);
  });

  it('should return 400 for missing required fields in task creation', async () => {
    const response = await request(app)
      .post('/a2a/tasks/send')
      .send({})
      .expect(400);
    
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('Missing required fields');
  });

  it('should return 404 for non-existent task', async () => {
    const response = await request(app)
      .get('/a2a/tasks/non-existent-id')
      .expect(404);
    
    expect(response.body).toHaveProperty('error');
  });

  it('should return empty tasks list when no active tasks', async () => {
    const response = await request(app)
      .get('/a2a/tasks')
      .expect(200);
    
    expect(response.body).toHaveProperty('tasks');
    expect(response.body).toHaveProperty('count', 0);
    expect(Array.isArray(response.body.tasks)).toBe(true);
  });
});