/**
 * Simple test to verify A2A endpoints are working
 */

import http from 'http';

// Test the agent card endpoint
function testAgentCard() {
  console.log('Testing /.well-known/agent.json endpoint...');
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/.well-known/agent.json',
    method: 'GET',
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    
    res.on('data', (chunk) => {
      try {
        const data = JSON.parse(chunk);
        console.log('Response:', JSON.stringify(data, null, 2));
        
        if (data.name === 'Co-Agent Platform') {
          console.log('✅ Agent card endpoint is working correctly!');
        } else {
          console.log('❌ Unexpected response from agent card endpoint');
        }
      } catch (e) {
        console.log('Error parsing response:', e.message);
        console.log('Raw response:', chunk.toString());
      }
    });
    
    res.on('end', () => {
      console.log('Request completed');
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.end();
}

// Test A2A agents endpoint
function testA2AAgents() {
  console.log('\nTesting /a2a/agents endpoint...');
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/a2a/agents',
    method: 'GET',
  };

  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    
    res.on('data', (chunk) => {
      try {
        const data = JSON.parse(chunk);
        console.log('Response:', JSON.stringify(data, null, 2));
        
        if (data.agents !== undefined) {
          console.log('✅ A2A agents endpoint is working correctly!');
        } else {
          console.log('❌ Unexpected response from A2A agents endpoint');
        }
      } catch (e) {
        console.log('Error parsing response:', e.message);
        console.log('Raw response:', chunk.toString());
      }
    });
    
    res.on('end', () => {
      console.log('Request completed');
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.end();
}

// Run tests
testAgentCard();
setTimeout(testA2AAgents, 2000); // Wait 2 seconds between requests