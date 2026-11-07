#include <algorithm>
#include <iostream>
#include <vector>

using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int tests;
    if (!(cin >> tests)) return 0;
    while (tests--) {
        int n;
        cin >> n;
        vector<int> duration(n);
        for (int& t : duration) cin >> t;
        sort(duration.begin(), duration.end());

        long long elapsed = 0, answer = 0;
        for (int t : duration) {
            answer += elapsed;
            elapsed += t;
        }
        cout << answer << '\n';
    }
}
