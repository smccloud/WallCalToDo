// CI for the three packages: server/, frontend/, companion/.
//
// Requires the NodeJS plugin with a tool named 'node-20' (Node >= 20.19 --
// jsdom@^29 declares engines ^20.19.0) configured under Manage Jenkins ->
// Tools, and a GitHub credential (SSH key or HTTPS PAT) matching the repo's
// clone URL. `timestamps()` needs the Timestamper plugin -- drop it if you
// don't have it. The suites need no .env, no secrets and no network egress:
// external APIs are mocked and the tests use a scratch data directory of
// their own.
pipeline {
    agent any

    tools {
        nodejs 'node-20'
    }

    options {
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
    }

    environment {
        CI = 'true'
    }

    stages {
        stage('Install') {
            parallel {
                stage('server')    { steps { dir('server')    { sh 'npm ci' } } }
                stage('frontend')  { steps { dir('frontend')  { sh 'npm ci' } } }
                stage('companion') { steps { dir('companion') { sh 'npm ci' } } }
            }
        }

        stage('Test') {
            parallel {
                stage('server') {
                    steps {
                        dir('server') {
                            sh 'npm test -- --reporter=default --reporter=junit --outputFile junit.xml'
                        }
                    }
                }
                stage('frontend') {
                    steps {
                        dir('frontend') {
                            sh 'npm test -- --reporter=default --reporter=junit --outputFile junit.xml'
                        }
                    }
                }
                stage('companion') {
                    steps {
                        dir('companion') {
                            sh 'npm test -- --reporter=default --reporter=junit --outputFile junit.xml'
                        }
                    }
                }
            }
        }

        stage('Build') {
            parallel {
                stage('frontend')  { steps { dir('frontend')  { sh 'npm run build' } } }
                stage('companion') { steps { dir('companion') { sh 'npm run build' } } }
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: '*/junit.xml'
        }
    }
}
