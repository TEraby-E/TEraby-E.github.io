#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

struct Edge {
    int to;
    int next;
};

int farthest(int start, const vector<int>& head, const vector<Edge>& edges,
             vector<int>& distance, vector<int>& queue) {
    fill(distance.begin(), distance.end(), -1);
    distance[start] = 0;
    int front = 0, rear = 0;
    queue[rear++] = start;

    while (front < rear) {
        int u = queue[front++];
        for (int i = head[u]; i != -1; i = edges[i].next) {
            int v = edges[i].to;
            if (distance[v] != -1) continue;
            distance[v] = distance[u] + 1;
            queue[rear++] = v;
        }
    }
    return queue[rear - 1];
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;
    vector<int> head(n + 1, -1);
    vector<Edge> edges;
    edges.reserve(2 * (n - 1));

    for (int i = 1; i < n; ++i) {
        int u, v;
        cin >> u >> v;
        edges.push_back({v, head[u]});
        head[u] = static_cast<int>(edges.size()) - 1;
        edges.push_back({u, head[v]});
        head[v] = static_cast<int>(edges.size()) - 1;
    }

    vector<int> distance(n + 1), queue(n);
    int u = farthest(1, head, edges, distance, queue);
    int v = farthest(u, head, edges, distance, queue);
    cout << distance[v] << '\n';
}
