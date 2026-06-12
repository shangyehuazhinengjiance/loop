// AI Native Loop — v2 Docker 构建（四镜像）
// Git 源：https://github.com/shangyehuazhinengjiance/loop
// 关键：docker build 的 context 必须是仓库根目录（最后一个参数为 .）
//
// 环境变量（Job 参数或 Credentials）：
//   REGISTRY          镜像仓库前缀，如 harbor.qihoo.net/ai-native
//   BUILD_V1          设为 true 时额外构建 v1 NestJS orchestrator（已废弃）
//   NEXT_PUBLIC_*     Web 镜像构建时写入前端 bundle

pipeline {
  agent any

  environment {
    REGISTRY = "${env.REGISTRY ?: 'harbor.qihoo.net/ai-native'}"
    TAG = "${env.BUILD_NUMBER ?: env.GIT_COMMIT?.take(12) ?: 'latest'}"
    DOCKER_BUILDKIT = '1'
    BUILD_V1 = "${env.BUILD_V1 ?: 'false'}"
    NEXT_PUBLIC_ORCHESTRATOR_URL = "${env.NEXT_PUBLIC_ORCHESTRATOR_URL ?: 'https://api.loop.example.com'}"
    NEXT_PUBLIC_WS_URL = "${env.NEXT_PUBLIC_WS_URL ?: 'wss://ws.loop.example.com'}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh '''
          test -f packages/shared/package.json
          test -f packages/orchestrator-v2/requirements.txt
          test -f Dockerfile.orchestrator-v2
          test -f Dockerfile.agent-worker
        '''
      }
    }

    stage('Build v2 Images') {
      steps {
        sh '''
          chmod +x scripts/build-images.sh
          REGISTRY="$REGISTRY" TAG="$TAG" BUILD_V1="$BUILD_V1" \
            NEXT_PUBLIC_ORCHESTRATOR_URL="$NEXT_PUBLIC_ORCHESTRATOR_URL" \
            NEXT_PUBLIC_WS_URL="$NEXT_PUBLIC_WS_URL" \
            ./scripts/build-images.sh
        '''
      }
    }

    stage('Push') {
      when {
        expression { return env.REGISTRY?.trim() }
      }
      steps {
        sh '''
          for name in orchestrator-v2 agent-worker gateway web; do
            docker push "${REGISTRY}/loop-${name}:${TAG}"
          done
          if [ "$BUILD_V1" = "true" ]; then
            docker push "${REGISTRY}/loop-orchestrator:${TAG}"
          fi
        '''
      }
    }
  }

  post {
    success {
      echo "Built: loop-orchestrator-v2 loop-agent-worker loop-gateway loop-web :${TAG}"
    }
  }
}
