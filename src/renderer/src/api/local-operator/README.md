# Local Operator API Client

A TypeScript client for the Local Operator API (v0.3.7).

## Overview

This client provides a type-safe interface to interact with the Local Operator API. It includes:

- Full TypeScript types for all API requests and responses
- Separate modules for each API section (Health, Chat, Agents, Jobs)
- A unified client that provides access to all API endpoints

## Installation

The client is part of the Local Operator UI project and doesn't require separate installation.

## Usage

### Creating a client instance

```typescript
import { createLocalOperatorClient } from '@api/local-operator';

// Create a client instance with the API base URL
const client = createLocalOperatorClient('http://localhost:8000');
```

### Health API

Check the health status of the API server:

```typescript
// Using the unified client
const healthStatus = await client.health.healthCheck();
console.log(`API Status: ${healthStatus.status} - ${healthStatus.message}`);

// Or using the individual API module
import { HealthApi } from '@api/local-operator';
const healthStatus = await HealthApi.healthCheck('http://localhost:8000');
```

### Chat API

Process a chat request:

```typescript
// Using the unified client
const response = await client.chat.processChat({
  prompt: "Print 'Hello, world!'",
  hosting: "openai",
  model: "gpt-4o",
  context: [],
  options: {
    temperature: 0.7,
    top_p: 0.9
  }
});

console.log(`Response: ${response.response}`);
console.log(`Total tokens: ${response.stats.total_tokens}`);

// Chat with a specific agent
const agentResponse = await client.chat.chatWithAgent('agent123', {
  prompt: "How do I implement a binary search in Python?",
  hosting: "openai",
  model: "gpt-4o",
  context: [],
  options: {
    temperature: 0.7
  }
});

// Process a chat request asynchronously
const jobId = await client.chat.processChatAsync({
  prompt: "Generate a long report on climate change",
  hosting: "openai",
  model: "gpt-4o",
  context: []
});
console.log(`Job ID: ${jobId}`);
```

### Agents API

Manage agents:

```typescript
// List all agents
const agentsResponse = await client.agents.listAgents();
console.log(`Total agents: ${agentsResponse.result?.total}`);

// Create a new agent
const newAgent = await client.agents.createAgent({
  name: "My Test Agent",
  security_prompt: "Custom security prompt",
  hosting: "openrouter",
  model: "openai/gpt-4o-mini"
});

// Get agent details
const agentDetails = await client.agents.getAgent('agent123');

// Update an agent
const updatedAgent = await client.agents.updateAgent('agent123', {
  name: "Updated Agent Name"
});

// Delete an agent
const deleteResult = await client.agents.deleteAgent('agent123');

// Get agent conversation history
const conversation = await client.agents.getAgentConversation('agent123');
console.log(`Messages: ${conversation.messages?.length}`);
```

### Jobs API

Manage asynchronous jobs:

```typescript
// Get job status
const jobStatus = await client.jobs.getJobStatus('job-123456');
console.log(`Job status: ${jobStatus.result?.status}`);

// Cancel a job
const cancelResult = await client.jobs.cancelJob('job-123456');

// List all jobs
const allJobs = await client.jobs.listJobs();
console.log(`Total jobs: ${allJobs.result?.count}`);

// List jobs for a specific agent
const agentJobs = await client.jobs.listJobs('agent123');

// List jobs with a specific status
const pendingJobs = await client.jobs.listJobs(undefined, 'pending');

// Cleanup old jobs
const cleanupResult = await client.jobs.cleanupJobs(48); // Remove jobs older than 48 hours
console.log(`Removed ${cleanupResult.result?.removed_count} jobs`);
```

## Error Handling

All API methods throw errors if the request fails:

```typescript
try {
  const response = await client.chat.processChat({
    prompt: "Hello",
    hosting: "openai",
    model: "gpt-4o"
  });
  // Handle successful response
} catch (error) {
  console.error('API request failed:', error.message);
}
```

## Types

The client exports all types used in the API:

```typescript
import { 
  ChatRequest, 
  ChatResponse, 
  AgentDetails,
  JobStatus,
  // etc.
} from '@api/local-operator';
